var tape = require('tape');
var util = require('../lib/util');

tape('Identity', function(t){
  function I(source){
    return util.decode(util.encode(source));
  }
  for(var i = 0; i < 10;i++){
    var v = Math.random();
    t.equal(v, I(v));
  }
  t.end();
});
