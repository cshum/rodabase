var tape = require('tape');
var util = require('../lib/util');

tape('Identity', function(t){
  function I(source){
    return util.decode(util.encode(source));
  }
  for(var i = 0; i < 1000;i++){
    var v = Math.random();
    t.equal(v, I(v));
  }
  t.end();
});

tape('lexicographical', function(t){
  var ok = true;
  var prev = util.encode(0);
  for(var i = 1; i < 1000; i++){
    var curr = util.encode(i);
    ok &= curr > prev;
    prev = curr;
  }
  t.ok(ok);
  t.end();
});
