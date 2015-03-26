var tape = require('tape');
var nid = require('../lib/nid');

tape('Node ID', function(t){
  var test = 'test/data/nid';
  var test2 = 'test/data/nid2';
  var id = nid(test);
  var id2 = nid(test2);

  t.ok(id === nid(test), 'test === id');
  t.ok(id2 === nid(test2), 'test2 === id2');
  t.ok(id !== id2, 'test !== test2');
  t.ok(nid(test) !== nid(test2), 'test !== test2');
  t.end();
});
