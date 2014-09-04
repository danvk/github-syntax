// ==UserScript==
// @name          github syntax highlighter
// @namespace     http://github.com/johan/
// @description   Adds syntax highlighting to github pull requests.
// @include       https://github.com/*/pull/*
// @match         https://github.com/*/pull/*
// ==/UserScript==

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

function init() {
  var pr_spec = getPrSpec();
  if (!pr_spec) {
    console.log('unable to get pr spec, bailing');
    return;
  }

  console.log(pr_spec);

  console.log('Fetching PR info...');
  getPrInfo(pr_spec).done(function(pr_info) {
    console.log(pr_info);
  });

  // Remove the superfluous and copy/paste-hostile +/- signs.
  /*
  $('.blob-code-addition, .blob-code-deletion').each(function(idx, el) {
    var text = $(el).text();
    var newtext = text.replace(/^[-+]/, '')
    if (text.length != newtext.length) {
      $(el).text(newtext);
    }
  });
  */

  /*
  $.get('https://raw.githubusercontent.com/danvk/dygraphs/bacf5ce283d6871ce1c090f29bf5411341622248/auto_tests/tests/dygraph-options-tests.js')
    .done(function(response) {
      $(document.body).append($('<div>').text(response));
    });
  */
}

init();
