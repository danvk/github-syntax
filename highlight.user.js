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

function getPaths() {
  return $getFileDivs().map(function(_, div) {
    return $(div).find('.meta').attr('data-path');
  });
}

function addButtonToFileDiv(idx, div) {
  var $button = $('<a href="#">Highlight</a>')
      .data('file-index', idx)
      .addClass('minibutton tooltipped tooltipped-n syntax-highlight')
      .css('margin-right', '5px')
      .attr('aria-label', 'Apply syntax highlighting to this diff.');
  $($(div).find('.actions a').get(0)).before($button);
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

function init() {
  var pr_spec = getPrSpec();
  if (!pr_spec) {
    console.log('unable to get pr spec, bailing');
    return;
  }

  // Remove the superfluous and copy/paste-hostile +/- signs.
  $('.blob-code-addition, .blob-code-deletion').each(function(idx, el) {
    var text = $(el).text();
    var newtext = text.replace(/^[-+]/, '')
    if (text.length != newtext.length) {
      $(el).text(newtext);
    }
  });

  // Add "highlight" buttons to each diff.
  $getFileDivs().each(addButtonToFileDiv);

  GITHUB_SYNTAX.pr_spec = pr_spec;
  console.log(pr_spec);

  console.log('Fetching PR info...');
  getPrInfo(pr_spec).done(function(pr_info) {
    console.log(pr_info);
    GITHUB_SYNTAX.pr_info = pr_info;
  });

  $(document).on('click', 'a.syntax-highlight', function(e) {
    e.preventDefault();

    var fileIndex = $(this).data('file-index');
    var $fileDiv = $($getFileDivs().get(fileIndex));
    var path = getPaths()[fileIndex];

    var language = guessLanguage(path);
    if (!language) {
      console.log('Unable to guess language for', path);
      return;
    }

    $.get(getFileUrl(GITHUB_SYNTAX.pr_info, 'right', path)).done(function(contents) {
      var html = hljs.highlight(language, contents, true).value;
      GITHUB_SYNTAX.html = html;

      var htmlLines = codediff.distributeSpans_(html);
      $fileDiv.find('td.head[data-line-number]').map(function(_, el) {
        var $lineNumberDiv = $(el);
        var lineNumber = parseInt($lineNumberDiv.attr('data-line-number'), 10);
        var $code = $lineNumberDiv.next('.blob-code.head');
        $code.html(htmlLines[lineNumber - 1]);
      });
    });
  });

  /*
  $.get('https://raw.githubusercontent.com/danvk/dygraphs/bacf5ce283d6871ce1c090f29bf5411341622248/auto_tests/tests/dygraph-options-tests.js')
    .done(function(response) {
      $(document.body).append($('<div>').text(response));
    });
  */
}

init();
