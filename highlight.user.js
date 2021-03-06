// ==UserScript==
// @name          github syntax highlighter
// @namespace     http://github.com/johan/
// @description   Adds syntax highlighting to github pull requests.
// @include       https://github.com/*/pull/*
// @match         https://github.com/*/pull/*
// ==/UserScript==

// Available in console w/ context chrome-extension://ij...obn
GITHUB_SYNTAX = {};

// ref is either "ref" or "owner:ref". This returns {owner, ref}.
function parseRef(ref, defaultOwner) {
  var m = ref.match(/^([^:]+):([^:]+)$/);
  if (m) {
    return {owner: m[1], ref: m[2]};
  } else {
    return {owner: defaultOwner, ref: ref};
  }
};

function getSpec() {
  var loc = document.location;
  if (loc.hostname != 'github.com') return null;

  var p = loc.pathname;
  var m = p.match(/^\/([^\/]+)\/([^\/]+)\/pull\/([0-9]+)\/files/);
  if (m) {
    return {
      owner: m[1],
      repo: m[2],
      pull_number: m[3]
    };
  } else if (m = p.match(/^\/([^\/]+)\/([^\/]+)\/commit\/([0-9a-f]+)/)) {
    return {
      owner: m[1],
      repo: m[2],
      commit: m[3]
    };
  } else if (m = p.match(/^\/([^\/]+)\/([^\/]+)\/compare\//)) {
    // This matches both /compare/foo...bar and /compare/compare (new PR)
    var owner = m[1], repo = m[2];

    var refs = $('.range .branch-name').map(function(_, el) { return $(el).text().trim() });
    if (refs.length != 2) return;

    return {
      owner: m[1],
      repo: m[2],
      compareLeft: parseRef(refs[0], owner),
      compareRight: parseRef(refs[1], owner)
    };
  }

  return null;
}

// Take the spec as returned by getSpec() and return a deferred object with
// {owner, repo, sha} for both left and right. The returned deferred is like:
// {left: {owner, repo, sha}, right: {owner, repo, sha}}.
function getDiffInfo(spec) {
  if ('pull_number' in spec) {
    var url = 'https://api.github.com/repos/' + spec.owner + '/' + spec.repo + '/pulls/' + spec.pull_number;
    return $.ajax({
      dataType: "json",
      url: url,
      data: null
    }).then(function(pr_info) {
      return {
        'left': {
          'owner': pr_info.base.repo.owner.login,
          'repo': pr_info.base.repo.name,
          'sha': pr_info.base.sha
        },
        'right': {
          'owner': spec.owner,
          'repo': spec.repo,
          'sha': pr_info.head.sha
        }
      };
    });
  } else if ('commit' in spec) {
    // TODO: what about commits with multiple parents?
    var $parentSha = $('.commit-meta .sha[data-hotkey="p"]');
    if ($parentSha.length != 1) {
      var d = $.Deferred();
      d.reject('Unable to get a unique parent commit SHA.');
      return d;
    }
    var m = $parentSha.attr('href').match(/\/([0-9a-f]+)$/);
    if (!m) {
      var d = $.Deferred();
      d.reject('Unable to parse commit link ' + $parentSha.attr('href'));
      console.warn('Unable to parse commit link', $parentSha.attr('href'));
      return d;
    }
    return $.when({
      'left': {
        'owner': spec.owner,
        'repo': spec.repo,
        'sha': m[1]
      },
      'right': {
        'owner': spec.owner,
        'repo': spec.repo,
        'sha': spec.commit
      }
    });
  } else if ('compareLeft' in spec) {
    var deferredSha = function(owner, repo, ref) {
      var url = 'https://api.github.com/repos/' + owner + '/' + repo + '/git/refs/heads/' + ref;
      return $.ajax({
        dataType: "json",
        url: url,
        data: null
      }).then(function(ref_info) {
        return ref_info.object.sha;
      });
    };

    return $.when(deferredSha(spec.compareLeft.owner, spec.repo, spec.compareLeft.ref),
                  deferredSha(spec.compareRight.owner, spec.repo, spec.compareRight.ref))
            .then(function(leftSha, rightSha) {
              return {
                'left': {
                  'owner': spec.compareLeft.owner,
                  'repo': spec.repo,
                  'sha': leftSha,
                },
                'right': {
                  'owner': spec.compareRight.owner,
                  'repo': spec.repo,
                  'sha': rightSha
                }
              };
            });
  }
}

var LEFT = 'left',
    RIGHT = 'right';

function getFileUrl(diff_info, side, path) {
  if (side != LEFT && side != RIGHT) {
    throw "Invalid side " + side;
  }
  var spec = diff_info[side];

  return 'https://cdn.rawgit.com/' + spec.owner + '/' + spec.repo + '/' + spec.sha + '/' + path;
}

function $getFileDivs() {
  return $('.file[id^="diff-"]');
}

function guessLanguage(filename) {
  var m = /\.([^.]+)$/.exec(filename);
  if (m) {
    var ext = m[1];
    if (ext == 'py') return 'python';
    if (ext == 'sh') return 'bash';
    if (ext == 'md') return 'markdown';
    return m[1].toLowerCase();
  };

  // Highlighting based purely on file name, e.g. "Makefile".
  m = /(?:.*\/)?([^\/]*)$/.exec(filename);
  if (m && m[1] == 'Makefile') {
    return 'makefile';
  }
  return undefined;
}

// Returns a deferred array of HTML strings, one per line of the file.
function getHighlightedLines(language, path, fileUrl) {
  return $.ajax(fileUrl, {dataType: "text"}).then(
    function(contents) {
      var html;
      if (language) {
        html = hljs.highlight(language, contents, true).value;
      } else {
        // Need to guess.
        var guess = hljs.highlightAuto(contents);
        console.log('Guessing language', guess.language, 'for', path);
        html = guess.value;
      }
      return codediff.distributeSpans_(html);
    }, function(response, errortype, errordetails) {
      console.warn('Request for', fileUrl, 'failed', errortype, errordetails);
    });
}

// Adds syntax highlighting to one side or the other.
// This uses the syntax cache if it's available.
function applyHighlightingToSide(fileDiv, side) {
  if (side != LEFT && side != RIGHT) { throw "Invalid side " + side; }

  var $fileDiv = $(fileDiv);
  var path = $fileDiv.find('.meta').attr('data-path');

  // Don't attempt to highlight a pure add or pure delete. It will fail.
  if ((side == LEFT && $fileDiv.find('td.base:not(.empty-cell)').length == 0) ||
      (side == RIGHT && $fileDiv.find('td.head:not(.empty-cell)').length == 0)) {
    return { 'success': 'Nothing to do.' };
  }

  var htmlLines = $fileDiv.data('highlight-' + side);
  if (!htmlLines) {
    var language = guessLanguage(path);
    if (!language) {
      console.log('Unable to determine language for', path, 'from extension. Will guess from code.');
    }
    if (language == 'txt') {
      return;
    }
    if (language && !hljs.getLanguage(language)) {
      console.warn('Unable to highlight language', language);
      return;
    }
    return getHighlightedLines(language, path, getFileUrl(GITHUB_SYNTAX.diff_info, side, path))
      .then(function(htmlLines) {
        $fileDiv.data('highlight-' + side, htmlLines);
        return applyHighlightingToSide(fileDiv, side);  // try again with a filled cache.
      });
  } else {
    // The line number <td> is either the first in its row (left side) or third (right side).
    var k = side == 'left' ? 1 : 3;
    $fileDiv.find('td.blob-num[data-line-number]:not(.highlighted):nth-child(' + k + ')').map(function(_, el) {
      var $lineNumberDiv = $(el);
      var lineNumber = parseInt($lineNumberDiv.attr('data-line-number'), 10);
      var $code = $lineNumberDiv.next('.blob-code');
      fillWithHighlightedCode($code.get(0), htmlLines[lineNumber - 1]);
      $lineNumberDiv.addClass('highlighted');
    });
    return $.when({success:true});  // a not-so-deferred deferred
  }
}


var LoadingIndicator = function(fileDiv) {
  this.fileDiv = fileDiv;
  this.$loading =
      $('<div class="github-syntax-loading">Highlighting&hellip;</div>')
      .addClass('tooltipped tooltipped-n')
      .attr('aria-label', 'The github-syntax Chrome extension is syntax highlighting this diff.');
  $($(this.fileDiv).find('.actions a').get(0)).before(this.$loading);
};

LoadingIndicator.prototype.done = function() {
  this.$loading.remove();
};

LoadingIndicator.prototype.showError = function(message) {
  console.warn('Highlighting failed', message);
  this.$loading
    .attr('aria-label', 'Syntax highlighting failed for this diff. See console for details.')
    .addClass('github-syntax-error')
    .text('Highlighting failed');
};


function applyHighlighting(fileDiv) {
  if ($(fileDiv).find('.suppressed').length > 0) {
    return $.when({});  // no point in highlighting this.
  }

  $(fileDiv).addClass('highlighted');  // blocks subsequent highlighting attempts

  var loading = new LoadingIndicator(fileDiv);
  return $.when(applyHighlightingToSide(fileDiv, 'left'),
                applyHighlightingToSide(fileDiv, 'right'))
    .then(function() {
      addCharacterDiffs(fileDiv);
      loading.done();
    }).fail(function(msg) {
      loading.showError(msg);
    });
}


// Look for lines that fillWithHighlightedCode() has hinted have character
// differences. github computes these on its own but codediff.js does it
// better.
function addCharacterDiffs(fileDiv) {
  $(fileDiv).find('tr:has(.github-syntax-chardiff)').each(function(_, tr) {
    $(tr).find('.github-syntax-chardiff')
        .removeClass('github-syntax-chardiff');  // we've got 'em.

    var $cells = $(tr).find('td.blob-code');
    if ($cells.length != 2) {
      console.warn('Strange character diff situation in', tr);
      return;
    }

    // Temporarily remove the line comment buttons, which confuse codediff.js
    var $beforeCell = $($cells.get(0)),
        $afterCell = $($cells.get(1)),
        $beforeSave = $beforeCell.find('.add-line-comment');
        $afterSave = $afterCell.find('.add-line-comment');

    $beforeSave.remove();
    $afterSave.remove();

    codediff.addCharacterDiffs_($beforeCell.get(0), $afterCell.get(0));
    $beforeCell.prepend($beforeSave);
    $afterCell.prepend($afterSave);
  });
}


// Fill out a code line in the diff, preserving the "add comment" button.
function fillWithHighlightedCode(el, html) {
  var $save = $(el).find('.add-line-comment');
  var $chardiff = $(el).find('.x');
  $(el).html(html)
      .prepend($save);
  if ($chardiff.length) {
    $(el).addClass('github-syntax-chardiff');  // candidate for character diffs.
  }
}


var inited_spec = '';
function init() {
  var spec = getSpec();
  if (!spec) {
    GITHUB_SYNTAX = {};
    inited_spec = '';
    return;  // Probably not a Pull Request view.
  }
  var this_spec = JSON.stringify(spec);
  if (this_spec == inited_spec) return;  // nothing to do.
  inited_spec = this_spec;

  if ($('.file-diff-split').length == 0) {
    // This is an inline diff view, not a split diff view.
    console.log('No split diffs found');
    return;
  }

  GITHUB_SYNTAX.spec = spec;

  getDiffInfo(spec).done(function(diff_info) {
    GITHUB_SYNTAX.diff_info = diff_info;

    $(document.body).off('appear.github-syntax');  // there can only be one.
    $getFileDivs().appear({force_process:true});
    $(document.body).on('appear.github-syntax', '.file[id^="diff-"]:not(.highlight-seen)', function() {
      var fileDiv = this;
      $(fileDiv).addClass('highlight-seen');

      // Apply syntax highlighting. When that's done, listen for subtree
      // modifications. These indicate that there may be new lines to highlight.
      // The tricky this is that we don't want to ever be listening for subtree
      // modifications when we're about to do some highlighting.
      var observer;
      var addHighlights = function() {
        observer.disconnect();
        applyHighlighting(fileDiv)
          .done(function() {
            observer.observe(fileDiv, {childList: true, subtree: true});
          });
      };
      var observer = new MutationObserver(addHighlights);  // not observing yet...
      addHighlights();
    });
  }).fail(function(err) {
    console.warn('Unable to get diff left/right SHAs', err);
  });
}

init();

// Detect in-page navigations, which might result in files to highlight.
// It would be nice not to poll, but I can't find a good way to avoid it!
var lastLocation = document.location.href;
window.setInterval(function() {
  var loc = document.location.href;
  if (loc == lastLocation) return;
  lastLocation = loc;

  init();
}, 500);
