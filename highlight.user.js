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

  return 'https://raw.githubusercontent.com/' + side_info.repo.full_name + '/' + sha + '/' + path;
}

function $getFileDivs() {
  return $('.file[id^="diff-"]');
}

function guessLanguage(filename) {
  var m = /\.([^.]+)$/.exec(filename);
  if (m) {
    var ext = m[1];
    if (ext == 'py') return 'python';
    return m[1];
  } else {
    return undefined;
  }
}

// Returns a deferred array of HTML strings, one per line of the file.
function getHighlightedLines(language, fileUrl) {
  return $.get(fileUrl).then(function(contents) {
    var html = hljs.highlight(language, contents, true).value;
    return codediff.distributeSpans_(html);
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

function applyHighlighting(fileDiv) {
  $(fileDiv).addClass('highlighted');
  return $.when(applyHighlightingToSide(fileDiv, 'left'),
                applyHighlightingToSide(fileDiv, 'right'));
}


// Fill out a code line in the diff, preserving the "add comment" button.
function fillWithHighlightedCode(el, html) {
  var $save = $(el).find('.add-line-comment');
  $(el).html(html)
      .prepend($save);
}


var has_inited = false;
function init() {
  if (has_inited) return;
  var pr_spec = getPrSpec();
  if (!pr_spec) {
    console.log('unable to get pr spec, bailing');
    return;
  }
  has_inited = true;

  GITHUB_SYNTAX.pr_spec = pr_spec;
  console.log(pr_spec);

  console.log('Fetching PR info...');
  getPrInfo(pr_spec).done(function(pr_info) {
    GITHUB_SYNTAX.pr_info = pr_info;
  });

  $getFileDivs().appear({force_process:true});
  $(document.body).on('appear', '.file[id^="diff-"]:not(.highlight-seen)', function() {
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
}

init();

$('.tabnav-tabs').on('click', 'li', function() {
  // hack to get the new URL, not the old one.
  window.setTimeout(function() {
    init();
  }, 200);
});
