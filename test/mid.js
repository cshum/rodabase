var tape = require('tape');
var mid = require('../lib/mid');

tape('MID', function(t){
  var test = 'test/data/mid';
  var test2 = 'test/data/mid2';
  var id = mid(test);
  var id2 = mid(test2);

  t.ok(id === mid(test), 'test === id');
  t.ok(id2 === mid(test2), 'test2 === id2');
  t.ok(id !== id2, 'test !== test2');
  t.ok(mid(test) !== mid(test2), 'test !== test2');
  t.equal(id.length, 8, 'id length 8');
  t.equal(id2.length, 8, 'id2 length 8');
  t.end();
});
