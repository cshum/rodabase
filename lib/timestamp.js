//monotonic timestamp
var count = 0, last = 0;

module.exports = function(){
  var now = Date.now();
  if(last === now)
    count++;
  else
    count = 0;
  last = now;
  return now * 1000 + count;
};

