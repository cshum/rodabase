var tape = require('tape');
var util = require('../lib/util');

tape('lexicographical and identity', function(t){
  var ok = true;
  var m = 1000000;
  var em = util.encode(m);

  for(var i = 1; i < 1000; i++){
    var n = Math.random() * m;
    var en = util.encode(n);
    ok &= (n >= m && en >= em) || (n < m && en < em);
    ok &= n === util.decode(en);
  }
  t.ok(ok);
  t.end();
});

tape('clockObject', function(t){
  var clock = '01234567abc,12345678def,23456789ghi';
  t.deepEqual(util.clockObject(clock), {
    '01234567':'abc',
    '12345678':'def',
    '23456789':'ghi'
  });
  t.end();
});
