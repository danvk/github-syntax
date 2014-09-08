// ==UserScript==
// @name          github syntax highlighter
// @namespace     http://github.com/johan/
// @description   Adds syntax highlighting to github pull requests.
// @include       https://github.com/*/pull/*
// @match         https://github.com/*/pull/*
// ==/UserScript==

// Available in console w/ context chrome-extension://ij...obn
GITHUB_SYNTAX = {};

function getPrSpec() {
  var loc = document.location;
  if (loc.hostname != 'github.com') return null;

  var p = loc.pathname;
  var m = p.match(/^\/([^\/]+)\/([^\/]+)\/pull\/([0-9]+)\/files/);
  if (!m) return null;

  return {
    owner: m[1],
    repo: m[2],
    pull_number: m[3]
  };
}

function getPrInfo(spec) {
  var url = 'https://api.github.com/repos/' + spec.owner + '/' + spec.repo + '/pulls/' + spec.pull_number;
  console.log(url);
  return $.ajax({
    dataType: "json",
    url: url,
    data: null
  });
}

var LEFT = 'left',
    RIGHT = 'right';

function getFileUrl(pr_info, side, path) {
  if (side != LEFT && side != RIGHT) {
    throw "Invalid side " + side;
  }

  var side_info = pr_info[side == LEFT ? 'base' : 'head'];
  var sha = side_info.sha;

  return 'https://cdn.rawgit.com/' + side_info.repo.full_name + '/' + sha + '/' + path;
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
    return m[1];
  } else {
    return undefined;
  }
}

// Returns a deferred array of HTML strings, one per line of the file.
function getHighlightedLines(language, fileUrl) {
  return $.ajax(fileUrl, {dataType: "text"}).then(
    function(contents) {
      var html = hljs.highlight(language, contents, true).value;
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

  var htmlLines = $fileDiv.data('highlight-' + side);
  if (!htmlLines) {
    var language = guessLanguage(path);
    if (!language) {
      console.log('Unable to guess language for', path);
      return;
    }
    return getHighlightedLines(language, getFileUrl(GITHUB_SYNTAX.pr_info, side, path))
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
  $(fileDiv).addClass('highlighted');  // blocks subsequent highlighting attempts
  var loading = new LoadingIndicator(fileDiv);
  return $.when(applyHighlightingToSide(fileDiv, 'left'),
                applyHighlightingToSide(fileDiv, 'right'))
    .then(function() {
      loading.done();
    }).fail(function(msg) {
      loading.showError(msg);
    });
}


// Fill out a code line in the diff, preserving the "add comment" button.
function fillWithHighlightedCode(el, html) {
  var $save = $(el).find('.add-line-comment');
  $(el).html(html)
      .prepend($save);
}


var inited_spec = '';
function init() {
  var pr_spec = getPrSpec();
  if (!pr_spec) {
    return;  // Probably not a Pull Request view.
  }
  var this_spec = JSON.stringify(pr_spec);
  if (this_spec == inited_spec) return;  // nothing to do.
  inited_spec = this_spec;

  GITHUB_SYNTAX.pr_spec = pr_spec;
  console.log(pr_spec);

  console.log('Fetching PR info...');
  getPrInfo(pr_spec).done(function(pr_info) {
    GITHUB_SYNTAX.pr_info = pr_info;

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

  console.log('Detected URL change!');
  init();
}, 500);
