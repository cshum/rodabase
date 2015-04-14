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
  t.plan(1);
  var api = roda('1');
  var tx = roda.transaction();
  var i;

  for(i = 0; i < n; i++)
    api.put({ _id: encode(i), i: i }, tx);
  for(i = 0; i < n; i+=3)
    api.del(encode(i), tx);

  var result = [];

  tx.commit(function(){
    api.changes(function(err, changes){
      api.queue('1')
        .use('job', function(ctx, next){
          result.push(ctx.result);
          next();
        })
        .use('end', function(ctx, next){
          t.deepEqual(result, changes, 'queue list === changes');
          next();
        })
        .start();
    });
  });
});
