var tape = require('tape');
var rodabase = require('../');
var memdown = require('memdown');
var jsondown = require('jsondown');

var roda = rodabase('./test/data/crud.json', {
  // db: memdown
  db: jsondown
});

/*
tape('Put 10', function(t){
  var tx = roda.transaction();
  t.plan(2);
  for(var i = 0; i < 10; i++)
    roda('test').put({
      i: i
    }, tx, function(err, val){
      console.log(val);
    });
  tx.commit(function(err){
  });
});
*/

tape('tx Put 10', function(t){
  t.plan(2);
  for(var i = 0; i < 10; i++){
    var tx = roda.transaction();
    roda('test2').put({
      i: i
    }, tx, function(err, val){
      console.log(val);
    });
    if(i === 9)
      tx.commit(function(err){
        console.log('done');
      });
  }
});
