var tape = require('tape');
var rodabase = require('../');
var memdown = require('memdown');
var jsondown = require('jsondown');

var roda = rodabase('./test/data/crud.json', {
  // db: memdown
  db: jsondown
});

tape('Put 10 increments', function(t){
  t.plan(2 * 10);
  var _id = '', _rev = '';
  for(var i = 0; i < 10; i++){
    roda('test2').put({
      i: Math.random()
    }, function(err, val){
      t.ok(val._id > _id, '_id increments');
      t.ok(val._rev > _rev, '_rev increments');
      _id = val._id;
      _rev = val._rev;
    });
  }
});

