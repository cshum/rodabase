function Queue(){
  if(!(this instanceof Queue))
    return new Queue();
  this._q = [];
}
var q = Queue.prototype;
q.add = function(fn){
  this._q.push(fn);
  return this;
};
q.start = function(fn, err){
  var self = this;
  if(this._q.length > 0 && !err){
    this._q.shift()(function(err){
      setImmediate(self.start.bind(self, fn, err));
    });
  }else{
    fn(err);
  }
  return this;
};
module.exports = Queue;
