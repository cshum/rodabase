var tape = require('tape');
var util = require('../lib/util');

tape('Identity', function(t){
  function I(source){
    return util.decode(util.encode(source));
  }
  var ok = true;
  for(var i = 0; i < 1000;i++){
    var v = Math.random();
    ok &= v === I(v);
  }
  t.ok(ok);
  t.end();
});

tape('lexicographical', function(t){
  var ok = true;
  var m = 1000000;
  var em = util.encode(m);

  for(var i = 1; i < 1000; i++){
    var n = Math.random() * m;
    var en = util.encode(n);
    ok &= (n >= m && en >= em) || (n < m && en < em);
  }
  t.ok(ok);
  t.end();
});
