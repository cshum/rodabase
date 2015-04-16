#Rodabase

Node.js transactional document store, built on [LevelDB](https://github.com/rvagg/node-levelup).
Rodabase simplifies application development with an easy-to-use API and inherent consistency.
* Schemaless by default, constraint when needed.
* Transactions with ACID compliance.

[![Build Status](https://travis-ci.org/cshum/rodabase.svg?branch=master)](https://travis-ci.org/cshum/rodabase)

```bash
$ npm install rodabase leveldown
```
[LevelDOWN](https://github.com/rvagg/node-leveldown) is the default backend store for LevelDB. 

**License** MIT

<!-- START doctoc generated TOC please keep comment here to allow auto update -->
<!-- DON'T EDIT THIS SECTION, INSTEAD RE-RUN doctoc TO UPDATE -->
##Guide

- [rodabase(path[, options])](#rodabasepath-options)
- [roda(name)](#rodaname)
  - [.put([id], doc, [tx], [cb])](#putid-doc-tx-cb)
  - [.get(id, [tx], [cb])](#getid-tx-cb)
  - [.del(id, [tx], [cb])](#delid-tx-cb)
  - [.index(name, mapper)](#indexname-mapper)
  - [.read([index], [options], [cb])](#readindex-options-cb)
- [Transaction](#transaction)
  - [.use('validate', [hook...])](#usevalidate-hook)
  - [.use('diff', [hook...])](#usediff-hook)
  - [roda.transaction()](#rodatransaction)
- [Changes](#changes)
  - [.changes([since], [limit], [cb])](#changessince-limit-cb)
  - [.clock([cb])](#clockcb)
  - [.queue([name])](#queuename)

<!-- END doctoc generated TOC please keep comment here to allow auto update -->

###rodabase(path[, options])

```js
var rodabase = require('rodabase');

var roda = rodabase('./db');
```

###roda(name)

All operations are asynchronous although they don't necessarily require a callback.

####.put([id], doc, [tx], [cb])
Inserting, updating data into Rodabase. 

* `id`:  Primary key under namespace. Must be a string. Will auto generate a unique ID if not specifying one.
* `doc`: Resulting document. Must be a JSON serializable object.
* `tx`: Optional transaction object. See [Transaction](#transaction) section.

```js
//specify _id
roda('stuff').put('bob', { foo: 'bar' });

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

####.index(name, mapper)
#####emit(key, [doc], [unique])

```js
var users = roda('users');

users
  .index('email', function(doc, emit){
    emit(doc.email, true); //unique
  })
  .index('age', function(doc, emit){
    emit(doc.age); //non-unique
  });

users.get('foo@bar.com','email', ...); //get user by email
users.read('age', { gt: 15 }, ...); //list users over age 15

```
####.read([index], [options], [cb])
* `prefix`
* `gt`
* `gte`
* `lt`
* `lte`
* `eq`
Obtains an array of all or ranged documents under the namespace.

###Transaction

Rodabase manages transaction states in asynchronous, isolated manner. Rodabase is ACID compliant:

* **Atomicity**: Transactions complete either entirely or no effect at all. Made possible thanks to atomic [batch](https://github.com/rvagg/node-levelup#dbbatcharray-options-callback-array-form) operations in LevelDB.
* **Consistency**: Rodabase features "transaction hooks", allowing fine-grain control over data integrity, validations, logging, consistently throughout the application. With a very simple API.
* **Isolation**: States of transactions are isolated until successful commits.
* **Durability**: Committed transactions are persistent. The amount of durability is [configurable](https://github.com/rvagg/node-levelup#dbputkey-value-options-callback) as a LevelDB option.

This enables non-blocking, strong consistent way of dealing with data.

Under the hood, each write in Rodabase consists of multiple, transactional reads and writes in LevelDB,
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

  next();
});

people.put({ name: 123 }, function(err, val){
  console.log(err); //Error: Name must be a string.
});
people.put({ name: 'bar' }, function(err, val){
  console.log(val.name); //BAR
});
```

####.use('diff', [hook...])
At `diff` stage, access to document and namespace clock is acquired.
Current and resulting document can be compared for additional log, diff related operations.

`hook` is a [Ginga middleware](https://github.com/cshum/ginga#middleware) function. 
Context object consists of the following properties:
* `ctx.current`: Current state of document. `null` if this is an insert.
* `ctx.result`: Resulting document. `ctx.result._deleted === true` if this is a delete. Unlike `validation` hook, resulting document cannot be modified at this stage.
* `ctx.transaction`: Transaction instance. Additional operations can be attached.

```js
var count = roda('count');
var log = roda('log');

count.use('diff', function(ctx, next){
  var from = ctx.current ? ctx.current.n : 0;
  var to = ctx.result.n || 0;

  //Transaction works across namespaces.
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

###Changes

####.changes([since], [limit], [cb])
####.clock([cb])
####.queue([name])

#####.use('job', [hook...])
#####.use('end', [hook...])
#####.use('error', [hook...])
#####.start()
#####.pause()
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
