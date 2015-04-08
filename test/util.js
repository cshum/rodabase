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

tape('clock', function(t){
  var str = '01234567abc,12345678def,23456789ghi';
  var obj = {
    '01234567':'abc',
    '12345678':'def',
    '23456789':'ghi'
  };
  t.deepEqual(util.clockObject(str), obj, 'clockObject');
  t.deepEqual(util.clockString(obj), str, 'clockString');
  t.end();
});

