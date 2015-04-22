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

  function queue(id, p, cb){
    var result = [];
    api.queue(id, p)
      .use('job', function(ctx, next){
        result.push(ctx.result.i);
        if(ctx.result.i === n - 1)
          cb(null, result);

        setTimeout(next, Math.random() + 1);
        // setTimeout(next, 500);
      })
      .start();
  }

  tx.commit(function(){
    api.changeStream({since: []}).pluck('i').toArray(function(changes){
      queue('bla', 1, function(err, list){
        t.deepEqual(list, changes, 'queue list == changes');
      });
      queue(null, 1, function(err, list){
        t.deepEqual(list, changes, 'queue list == changes');
      });
    });
  });
});
