var tape = require('tape');
var util = require('../lib/util');

tape('encode decode', function(t){
  var lex = true;
  var id = true;
  var m = 1000000;
  var em = util.encode(m);

  for(var i = 1; i < 1000; i++){
    var n = Math.random() * m;
    var en = util.encode(n);

    lex &= (n >= m && en >= em) || (n < m && en < em);
    id &= n === util.decode(en);
  }
  t.ok(lex, 'lexicographical');
  t.ok(id, 'identical');
  t.end();
});
tape('encode decode number', function(t){
  var lex = true;
  var id = true;
  var m = 1000000;
  var em = util.encodeNumber(m, true);

  for(var i = 1; i < 1000; i++){
    var n = Math.random() * m;
    var en = util.encodeNumber(n);

    lex &= (n >= m && en >= em) || (n < m && en < em);
    id &= n === util.decodeNumber(en);
  }
  t.ok(lex, 'lexicographical');
  t.ok(id, 'identical');
  t.end();
});

tape('clocks', function(t){
  var arr = ['01234567abc','12345678def','23456789ghi'];
  var obj = {
    '01234567':'abc',
    '12345678':'def',
    '23456789':'ghi'
  };
  t.deepEqual(util.clocksObject(arr), obj, 'clocksObject');
  t.deepEqual(util.clocks(obj), arr, 'clocks');
  t.end();
});

tape('timestamp', function(t){
  var prev = 0;
  var ok = true;
  for(var i = 0, l = 1000; i < l; i++){
    var time = util.timestamp();
    ok &= prev < time;
    prev = time;
  }
  t.ok(ok, 'monotonic');
  t.end();
});
