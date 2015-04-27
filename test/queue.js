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

tape('Queue parallel', function(t){
  t.plan(6);
  var api = roda('1');
  var tx = roda.transaction();
  var jobs = {};
  var i;

  for(i = 0; i < n; i++){
    api.put({ i: i }, tx);
    jobs[i] = true;
  }

  function queue(id, p){
    var remain = _.clone(jobs);
    api.queue(id, p)
      .use('job', function(ctx, next){
        delete remain[ctx.result.i];
        setTimeout(next, Math.random() + 1);
        if(_.size(remain) === 0)
          t.ok(true, 'passed. name: '+id+' parallel:'+p);
        // setTimeout(next, 500);
      })
      .start();
  }

  tx.commit(function(){
    api.changeStream({clocks: []}).pluck('i').toArray(function(changes){
      queue('boo', 1);
      queue('bla', 3);
      queue('taaa', 5);
      queue(null, 1);
      queue(null, 3);
      queue(null, 5);
    });
  });
});
