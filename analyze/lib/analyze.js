let file = 'dump.json';

if (0 < ARGUMENTS.length) {
  file = ARGUMENTS[0];
}

// imports
// const agency = require('agency');
const fs = require('fs');
const _ = require('underscore');
const AsciiTable = require('./ascii-table');

// variables
// const dump = agency.dump();

print("Using dump file '" + file + "'");

const dump = JSON.parse(fs.read(file)).agency;

let extractPrimaries = function(info, dump) {
  let primariesAll = {};
  let primaries = {};

  const health = dump.arango.Supervision.Health;

  _.each(health, function(server, key) {
    if (key.substring(0, 4) === 'PRMR') {
      primariesAll[key] = server;

      if (server.Status === 'GOOD') {
        primaries[key] = server;
      }
    }
  });

  info.primaries = primaries;
  info.primariesAll = primariesAll;
};

let printPrimaries = function(info) {
  var table = new AsciiTable('Primaries');
  table.setHeading('', 'status');

  _.each(info.primariesAll, function(server, name) {
    table.addRow(name, server.Status);
  });

  print(table.toString());
};

let setGlobalShard = function(info, shard) {
  let dbServer = shard.dbServer;
  let isLeader = shard.isLeader;

  if (!info.shardsPrimary[dbServer]) {
    info.shardsPrimary[dbServer] = {
      leaders: [],
      followers: [],
      realLeaders: []
    };
  }

  if (isLeader) {
    info.shardsPrimary[dbServer].leaders.push(shard);

    if (shard.isReadLeader) {
      info.shardsPrimary[dbServer].realLeaders.push(shard);
    }
  } else {
    info.shardsPrimary[dbServer].followers.push(shard);
  }
};

let extractDatabases = function(info, dump) {
  let databases = {};

  _.each(dump.arango.Plan.Databases, function(database, name) {
    databases[name] = _.extend({
      isSystem: (name.charAt(0) === '_')
    }, database);
  });

  info.databases = databases;
  info.collections = {};
  info.shardsPrimary = {};

  let allCollections = dump.arango.Plan.Collections;

  _.each(allCollections, function(collections, dbName) {
    let database = databases[dbName];
    database.collections = [];
    database.shards = [];
    database.leaders = [];
    database.followers = [];
    database.realLeaders = [];

    _.each(collections, function(collection, cId) {
      let full = dbName + "/" + collection.name;
      let coll = {
        name: collection.name,
        fullName: full,
        distributeShardsLike: collection.distributeShardsLike || '',
        numberOfShards: collection.numberOfShards,
        replicationFactor: collection.replicationFactor,
        isSmart: collection.isSmart,
        type: collection.type
      };

      database.collections.push(coll);
      info.collections[full] = coll;

      coll.shards = [];
      coll.leaders = [];
      coll.followers = [];

      _.each(collection.shards, function(shard, sName) {
        coll.shards.push(shard);

        let s = {
          shard: sName,
          database: dbName,
          collection: collection.name
        };

        if (1 < shard.length) {
          coll.leaders.push(shard[0]);
          setGlobalShard(info,
            _.extend({
              dbServer: shard[0],
              isLeader: true,
              isReadLeader: (coll.distributeShardsLike === '')
            }, s));

          for (let i = 1; i < shard.length; ++i) {
            coll.followers.push(shard[i]);
            setGlobalShard(info,
              _.extend({
                dbServer: shard[i],
                isLeader: false
              }, s));
          }
        }
      });

      if (coll.distributeShardsLike !== '') {
        coll.realLeaders = [];
      } else {
        coll.realLeaders = coll.leaders;
      }

      database.shards = database.shards.concat(coll.shards);
      database.leaders = database.leaders.concat(coll.leaders);
      database.followers = database.followers.concat(coll.followers);
      database.realLeaders = database.realLeaders.concat(coll.realLeaders);
    });
  });
};

let printDatabases = function(info) {
  var table = new AsciiTable('Databases');
  table.setHeading('', 'collections', 'shards', 'leaders', 'followers', 'Real-Leaders');

  _.each(_.sortBy(info.databases, x => x.name), function(database, name) {
    table.addRow(database.name, database.collections.length, database.shards.length,
      database.leaders.length, database.followers.length,
      database.realLeaders.length);
  });

  print(table.toString());
};

let printCollections = function(info) {
  var table = new AsciiTable('collections');
  table.setHeading('', 'RF', 'Shards Like', 'Shards', 'Type', 'Smart');

  _.each(_.sortBy(info.collections, x => x.fullName), function(collection, name) {
    table.addRow(collection.fullName, collection.replicationFactor,
      collection.distributeShardsLike, collection.numberOfShards,
      collection.type, collection.isSmart);
  });

  print(table.toString());
};

let printPrimaryShards = function(info) {
  var table = new AsciiTable('Primary Shards');
  table.setHeading('', 'Leaders', 'Followers', 'Real Leaders');

  _.each(info.shardsPrimary, function(shards, dbServer) {
    table.addRow(dbServer, shards.leaders.length, shards.followers.length, shards.realLeaders.length);
  });

  print(table.toString());
};

const info = {};

extractPrimaries(info, dump);
printPrimaries(info);
print();

extractDatabases(info, dump);
printDatabases(info);
print();
printCollections(info);
print();
printPrimaryShards(info);
print();