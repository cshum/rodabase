var tape    = require('tape');
var cms     = require('../');
var _       = require('underscore');

// var db = require('jsondown');
var db = require('memdown');

cms()
  .use(cms.resource('test.json', { db: db }))
  .bootstrap(function(){
    var test = this.resource('test');
    tape('Resource Create',function(t){
      t.plan(9 * 2);
      for(var i = 1; i <= 9; i++){
        test.create({ _id:i, i:i }, function(i, err, res){
          t.notOk(err);
          t.deepEqual(res.i, i);
        }.bind(null, i));
      }
    });

    tape('Resource Update',function(t){
      t.plan(5 * 2);

      for(var j = 1; j <= 5; j++){
        test.update(j, { j:j }, function(j, err, res){
          t.notOk(err);
          t.deepEqual(res.j, j);
        }.bind(null, j));
      }
    });

    tape('Resource Remove',function(t){
      t.plan(1);

      test.remove(1, function(err, res){
        t.notOk(err);
      });
    });

    tape('Resource List',function(t){
      t.plan(2);

      test.list(function(err, res){
        t.notOk(err);
        res = res.map(function(obj){
          return _.pick(obj,'_id','i','j');
        });
        t.deepEqual(res, [
          {_id:'2', j:2},
          {_id:'3', j:3},
          {_id:'4', j:4},
          {_id:'5', j:5},
          {_id:'6', i:6},
          {_id:'7', i:7},
          {_id:'8', i:8},
          {_id:'9', i:9}
        ]);
      });
    });

    tape('Resource Create Error',function(t){
      t.plan(8);

      for(var i = 2; i <= 9; i++){
        test.create({ _id:i, i:i }, function(i, err, res){
          t.ok(err);
        }.bind(null, i));
      }
    });

    tape('Resource Update Error',function(t){
      t.plan(1);

      test.update(1, { j:1 }, function(err, res){
        t.ok(err);
      });
    });
  });
