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

tape('Queue durable volatile', function(t){
  t.plan(2);
  var api = roda('1');
  var i;

  function queue(id, p, cb){
    var result = [];
    api.queue(id, p)
      .use('job', function(ctx, next){
        result.push(ctx.result.i);
        if(ctx.result.i === 'foo')
          cb(null, result);
        setTimeout(next, Math.random() + 1);
        // setTimeout(next, 500);
      })
      .start();
  }

  api.put({ i: 'foo' }, function(err, val){
    api.changeStream({after: []}).pluck('i').toArray(function(changes){
      queue('bla', 1, function(err, list){
        t.deepEqual(list, [val.i], 'durable queue list == [new item]');
      });
      queue(null, 1, function(err, list){
        t.deepEqual(list, changes, 'volatile queue list == changes');
      });
    });
  });
});
