#Rodabase

Transactional, embedded document store for Node.js, built on [LevelDB](https://github.com/rvagg/node-levelup).

[![Build Status](https://travis-ci.org/cshum/rodabase.svg?branch=master)](https://travis-ci.org/cshum/rodabase)

```bash
$ npm install rodabase leveldown
```
[LevelDOWN](https://github.com/rvagg/node-leveldown) is the default backend store for LevelDB. 

**License** MIT

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
**Guide**

- [rodabase(path[, options])](#rodabasepath-options)
- [roda(name)](#rodaname)
  - [.put([id], doc, [tx], [cb])](#putid-doc-tx-cb)
  - [.get(id, [tx], [cb])](#getid-tx-cb)
  - [.del(id, [tx], [cb])](#delid-tx-cb)
  - [.read([options], [cb])](#readoptions-cb)
- [Transaction](#transaction)
  - [roda.transaction()](#rodatransaction)
  - [.use('validate', [hook...])](#usevalidate-hook)
  - [.use('diff', [hook...])](#usediff-hook)
- [Changes](#changes)
  - [.changes([since], [limit], [cb])](#changessince-limit-cb)
  - [.clock([cb])](#clockcb)
- [Queue](#queue)
  - [.queue(name)](#queuename)
- [Utilities](#utilities)
  - [roda.db](#rodadb)
  - [roda(name).store](#rodanamestore)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

###rodabase(path[, options])

```js
var rodabase = require('rodabase');

var roda = rodabase('./db');
```

###roda(namespace)

All operations are asynchronous although they don't necessarily require a callback.

####.put([id], doc, [tx], [cb])
Inserting, updating data into Rodabase. 

* `id`:  Primary key under the namespace. Must be a string. Will auto generate a unique ID if not specifying one.
* `doc`: Resulting document. Must be a JSON serializable object.
* `tx`: Optional transaction object. See [Transaction](#transaction) section.

```js
//specify _id
roda('stuff').put('bob', { foo: 'bar' });
roda('stuff').put({ _id: 'bob', foo: 'bar' });

//auto generated _id
roda('stuff').put({ foo: 'bar' }, function(err, res){
  if(err) 
    return console.error('Error: ', err);

  console.log(res);
}); 

```
Auto generated _id is a 20 chars, URL-safe, base64 time sorted unique ID.

Example result:
```json
{ 
  "_id": "FZBJIBTCaLEJk8924J0A",
  "foo": "bar", 
  "_rev": "k8924J0AFZ"
} 

```

####.get(id, [tx], [cb])
Fetching data from Rodabase.

* `id`: Primary key under the namespace. Must be a string.
* `tx`: Optional transaction object. See [Transaction](#transaction) section.

Callback value returns document object.
If it doesn't exist in the store then the callback will receive a `null` value.

####.del(id, [tx], [cb])
Removes data from Rodabase.

* `id`: Primary key under the namespace. Must be a string.
* `tx`: Optional transaction object. See [Transaction](#transaction) section.

####.read([options], [cb])
Obtains an array of all or ranged documents under the namespace.

###Transaction

Rodabase manages transaction states in asynchronous, isolated manner. Rodabase is ACID compliant:

* **Atomicity**: Transactions complete either entirely or no effect at all. Made possible thanks to atomic [batch](https://github.com/rvagg/node-levelup#dbbatcharray-options-callback-array-form) operations in LevelDB.
* **Consistency**: Rodabase features "transaction hooks", allowing fine-grain control over data integrity, validations, logging, consistently throughout the application. With a very simple API.
* **Isolation**: States of transactions are isolated until successful commits.
* **Durability**: Committed transactions are persistent. The amount of durability is [configurable](https://github.com/rvagg/node-levelup#dbputkey-value-options-callback) as a LevelDB option.

This enables non-blocking, strong consistent way of dealing with data.

####roda.transaction()

Creates a new transaction instance of [level-async-transaction](https://github.com/cshum/level-async-transaction).
Enable transactional operations by injecting instance into `get()`, `put()`, `del()`.
Example below demonstrates isolation in transaction instance. 

```js
var count = roda('count');
var transaction = roda.transaction(); //create transaction instance

count.put('bob', { n: 167 });

count.get('bob', transaction, function(err, data){
  data.n++; //increment n by 1
  count.put('bob', data, transaction);

  count.get('bob', function(err, val){
    console.log(val.n); //equals 167

    transaction.commit(function(){
      count.get('bob', function(err, val){
        console.log(val.n); //equals 168
      });
    });
  });
});
```
Under the hood, each write in Rodabase consists of multiple reads and writes in LevelDB,
managed by its own transaction instance.
This can be described as following steps:

1. Begin
2. `validate` hook for `put`
3. Read current state of document and clock
5. `diff` hook for `put` or `del`
6. Write document, changes and clock
7. Commit

`validate` and `diff` are transaction hook that enables fine-grain control over data integrity, validations or logging. Additional operations can be attached to current transaction, invokes only on successful commit.

####.use('validate', [hook...])

`hook` is a [Ginga middleware](https://github.com/cshum/ginga#middleware) function. 
Context object consists of the following properties:
* `ctx.result`: Resulting document, can be accessed and modified with custom validation rules.
* `ctx.transaction`: Transaction instance. Additional operations can be attached.

```js
var people = roda('people');

people.use('validate', function(ctx, next){
  if(typeof ctx.result.name !== 'string')
    return next(new Error('Name must be a string.'));

  //modify result
  ctx.result.name = ctx.result.name.toUpperCase();

  //check existing
  people.get(ctx.result._id, ctx.transaction, function(err, val){
    if(val)
      return next(new Error(ctx.result._id + ' already exists.'));
    next();
  });
});

people.put('foo', { name: 123 }, function(err, val){
  console.log(err); //Error: Name must be a string.
});
people.put('foo', { name: 'bar' }, function(err, val){
  console.log(val.name); //BAR
});
people.put('foo', { name: 'bob' }, function(err, val){
  console.log(err); //Error: foo already exists.
});
```

####.use('diff', [hook...])
At `diff` stage, access to document and namespace clock is acquired.
Current and resulting document can be compared for additional log, diff related operations.

`hook` is a [Ginga middleware](https://github.com/cshum/ginga#middleware) function. 
Context object consists of the following properties:
* `ctx.current`: Current state of document. `null` if this is an insert.
* `ctx.result`: Resulting document. `null` if this is a delete. Unlike `validation` hook, resulting document cannot be modified at this stage.
* `ctx.transaction`: Transaction instance. Additional operations can be attached.

```js
var count = roda('count');
var log = roda('log');

count.use('diff', function(ctx, next){
  var from = ctx.current ? ctx.current.n : 0;
  var to = ctx.result ? ctx.result.n : 0;

  //Transaction works across different namespaces.
  log.put({ delta: to - from }, ctx.transaction);

  next();
});

count.put('bob', { n: 6 });
count.put('bob', { n: 8 });
count.del('bob', function(){
  log.read(function(err, data){
    console.log(data); 
    //[{ delta: 6 ...}, { delta: 2 ...}, { delta: -8 ...}]
  });
});
```

###Changes

####.changes([since], [limit], [cb])
####.clock([cb])

###Queue

####.queue(name)

```js
var users = roda('users');

users.queue('email')
  .use('job', function(ctx, next){
    sendEmail(ctx.result.email, function(err){
      if(err) return next(err);

      //email sent
      next();
    });
  })
  .start();

users.put({
  username: 'bob',
  email: 'bob@example.com'
}, function(err, data){
  //bob added. Email comes afterwards.
});

```
#####.use('job', [hook...])
#####.use('end', [hook...])
#####.use('error', [hook...])
#####.start()
#####.stop()

###Utilities

####roda.db

[LevelUP](https://github.com/rvagg/node-levelup) instance of Rodabase.

####roda(name).store

[level-sublevel](https://github.com/dominictarr/level-sublevel) section instance under namespace `name`.


