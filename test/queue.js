var rodabase = require('../');

var tape = require('tape');
var jsondown = require('jsondown');
var _ = require('underscore');

var roda = rodabase('./test/data/queue.json', {
  db: jsondown
});
var n = 100;
function encode(i){
  return roda.util.trim(roda.util.encode64(i));
}

tape('Queue', function(t){
  t.plan(2);
  var api = roda('1');
  var tx = roda.transaction();
  var i;

  for(i = 0; i < n; i++)
    api.put({ i: i }, tx);

  function queue(id, cb){
    var result = [];
    api.queue(id)
      .use('job', function(ctx, next){
        result.push(ctx.result);
        next();
      })
      .use('end', function(ctx, next){
        cb(null, result);
        this.pause();
        next();
      })
      .start();
  }

  tx.commit(function(){
    api.changes( function(err, changes){
      queue('bla', function(err, list){
        t.deepEqual(list, changes, 'queue list == changes');
      });
      queue(null, function(err, list){
        t.deepEqual(list, changes, 'queue list == changes');
      });
    });
  });
});
