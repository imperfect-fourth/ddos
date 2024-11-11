// From original index.ts
import { start } from "@hasura/ndc-duckduckapi";
import { makeConnector, duckduckapi, getDB } from "@hasura/ndc-duckduckapi";
import * as path from "path";
import axios from 'axios';
import { tracked_users, tracked_channels, seconds_in_week } from './functions';

var headers = { Authorization: "" };


const connectorConfig: duckduckapi = {
  dbSchema: `
    -- Add your SQL schema here.
    -- This SQL will be run on startup every time.
    -- DROP TABLE IF EXISTS message;
    -- DROP TABLE IF EXISTS thread;
    -- DROP TABLE IF EXISTS channel;
    -- DROP TABLE IF EXISTS user;
    CREATE TABLE if not exists channel (
        id varchar primary key,
        name text,
    );
    CREATE TABLE  if not exists  user (
        id text primary key,
        username text,
        is_bot bool,
        real_name text,
        display_name text,
    );
    CREATE TABLE   if not exists thread (
        ts double primary key,
        channel_id varchar references channel(id),
        reply_count int,
    );
    CREATE TABLE  if not exists message (
        ts double primary key,
        text text,
        user_id varchar references user(id),
        channel_id varchar references channel(id),
        thread_ts double references thread(ts),
        link text,
        by_bot bool,
    );
  `,
  functionsFilePath: path.resolve(__dirname, "./functions.ts"),
};

async function search_query(query: string, till_timestamp: number, cursor: string) {
    console.log("searching", query);
  try {
    const db = await getDB();
    const searchURL = "https://slack.com/api/search.messages";
    const searchParams = {
      count: 100,
      highlight: false,
      sort: "timestamp",
      query: `${query}`,
      cursor: cursor,
    };
    var response = await axios.get(searchURL, { headers, params: searchParams });
    console.log("got messages from search:", response.data["messages"]["matches"].length);
    var messages = response.data["messages"]["matches"];
    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      if (msg["ts"] < till_timestamp) {
        return "";
      }
      var msgStruct: Message = {
        ts: msg["ts"],
        text: "",
        user_id: "",
        channel_id: msg["channel"]["id"],
        thread_ts: 0,
        link: "",
        by_bot: false,
      };
      await insert_channel(msg["channel"]["id"], msg["channel"]["name"]);
      await load_thread(msgStruct);
    }
    if (response.data["response_metadata"]) {
      return response.data["response_metadata"]["next_cursor"];
    } else {
        return "";
    }
  } catch (err) {
    console.error(`error search_query: ${err}`);
  }
}

async function load_messages_from_user_helper(user_display_name: string, cursor: string) {
  return await search_query(`from:<@${user_display_name}>`, tracked_users.get(user_display_name) ?? (Date.now()/1000) - seconds_in_week, cursor) 
}

export async function load_messages_from_user(user_display_name: string) {
  var next_cursor = '*';
  while (true) {
    if (next_cursor === undefined) {
        break;
    }
    if (next_cursor === null) {
      break;
    }
    if (next_cursor === "") {
      break;
    }
    await sleep(1000);
    next_cursor = await load_messages_from_user_helper(user_display_name, next_cursor);
  }
}

async function load_threads_for_user_helper(user_display_name: string, cursor: string) {
  return await search_query(`@${user_display_name}`, tracked_users.get(user_display_name) ?? Date.now() - seconds_in_week, cursor) 
}

export async function load_threads_for_user(user_display_name: string) {
  console.log("loading threads");
  console.log(user_display_name);
  var next_cursor = '*';
  while (true) {
    if (next_cursor === undefined) {
        break;
    }
    if (next_cursor === null) {
      break;
    }
    if (next_cursor === "") {
      break;
    }
    await sleep(1000);
    next_cursor = await load_threads_for_user_helper(user_display_name, next_cursor);
    console.log(next_cursor);
  }
}

async function load_tracked_users() {
  setInterval(async () => {
    tracked_users.forEach(async (val, key) => {
      const db = await getDB();
//      await db.all('BEGIN TRANSACTION;');
      var tracked_until = Date.now();
      await load_threads_for_user(key);
      await load_messages_from_user(key);
//      await db.all('COMMIT');
      tracked_users.set(key, tracked_until);
    });
  }, 60000);
}

async function load_messages_in_channel_helper(channel_name: string, cursor: string) {
  return await search_query(`in:${channel_name}`, tracked_channels.get(channel_name) ?? Date.now() - seconds_in_week, cursor) 
}

export async function load_messages_in_channel(channel_name: string) {
  console.log("loading threads");
  var next_cursor = '*';
  while (true) {
    if (next_cursor === undefined) {
        break;
    }
    if (next_cursor === null) {
      break;
    }
    if (next_cursor === "") {
      break;
    }
    await sleep(1000);
    next_cursor = await load_messages_in_channel_helper(channel_name, next_cursor);
    console.log(next_cursor);
  }
}

async function load_tracked_channels() {
  setInterval(async () => {
    tracked_users.forEach(async (val, key) => {
      const db = await getDB();
//      await db.all('BEGIN TRANSACTION;');
      var tracked_until = Date.now();
      await load_messages_in_channel(key);
//      await db.all('COMMIT');
      tracked_channels.set(key, tracked_until);
    });
  }, 60000);
}

(async () => {
  const connector = await makeConnector(connectorConfig);
  start(connector);
  const slackAPIKey = process.env.SLACK_API_KEY;
  if (!slackAPIKey || slackAPIKey == "") {
    throw new Error("SLACK_API_KEY env needs to be set.");
  }
  headers = { Authorization: `Bearer ${slackAPIKey}` };

  await load_users();
  load_tracked_users();
  load_tracked_channels();
})();

type Thread = {
    ts: number,
    channel_id: string,
    reply_count: number,
}

type Message = {
    ts: number,
    text: string,
    user_id: string,
    channel_id: string,
    thread_ts: number,
    link: string,
    by_bot: boolean,
}

async function insert_message(msg: Message) {
  const db = await getDB();
  try {
    await db.all(`
      INSERT INTO message (ts, text, user_id, channel_id, thread_ts, link, by_bot)
      VALUES (
          ?::TEXT,
          ?::TEXT,
          ?::VARCHAR,
          ?::VARCHAR,
          ?::TEXT,
          ?::TEXT,
          ?::BOOLEAN,
      ) ON CONFLICT DO NOTHING;`,
      msg.ts,
      msg.text,
      msg.user_id,
      msg.channel_id,
      msg.thread_ts,
      msg.link,
      msg.by_bot,
    );
  } catch (err) {
    console.error('Error inserting data:', err);
  }
} 

async function insert_channel(id: string, name: string) {
  const db = await getDB();
  try {
    await db.all(`
      INSERT INTO channel (id, name)
      VALUES (
          ?::TEXT,
          ?::TEXT,
      ) ON CONFLICT DO NOTHING;`,
      id,
      name,
    );
  } catch (err) {
    console.error('Error inserting data:', err);
  }
} 

async function load_users() {
  var next_cursor = await get_users("");
  while (true) {
    if (next_cursor === undefined) {
        break;
    }
    if (next_cursor === null) {
      break;
    }
    if (next_cursor === "") {
      break;
    }
    await sleep(1000);
    next_cursor = await get_users(next_cursor);
  }
}

//async function loadCurrentUser() {
//  const db = await getDB();
//  var id = process.env.SLACK_USER_ID;
//  if (id) {
//    var user = await db.all(`SELECT id as id FROM user where id=?::TEXT`, id);
//    if (user.length !== 0) {
//      setCurrentUser(id);
//    } else {
//      throw new Error("SLACK_USER_ID is not a valid user id");
//    }
//  }
//}

async function get_users(cursor: string) {
  const db = await getDB();
  const usersURL = "https://slack.com/api/users.list";
  try {
    const params = {
        cursor: cursor,
        count: 300,
    };
    var p;
    if (cursor == "") {
      p = {headers};
    } else {
      p = {headers, params};
    }
    axios.get(usersURL, p)
      .then(response => {
        response.data["members"].forEach(async (user: any) => {
          await db.all(`
            INSERT INTO user (id, username, is_bot, real_name, display_name)
            VALUES (
                ?::TEXT,
                ?::TEXT,
                ?::BOOL,
                ?::TEXT,
                ?::TEXT,
            ) ON CONFLICT DO NOTHING;`,
            user.is_bot ? user.profile.bot_id : user.id,
            user.name,
            user.is_bot,
            user.real_name ? user.real_name : user.name,
            user.profile.display_name ? user.profile.display_name : user.name,
                      );
        });
        if (response.data["response_metadata"]) {
          return response.data["response_metadata"]["next_cursor"];
        } else {
            return "";
        }
      })
      .catch((error) => {
          console.error(`axios user resp err ${error}`);
      });
  } catch (err) {
    console.error('Error inserting data:', err);
    return "";
  }
}

async function load_thread(msg: Message) {
    try {
  const db = await getDB();
  const threadURL = "https://slack.com/api/conversations.replies";
  var threadParams;

  threadParams = {
    channel:  msg.channel_id,
    ts: msg.ts,
    cursor: "",
  };
  const response = await axios.get(threadURL, { headers, params: threadParams })
  if (!response.data["ok"]) {
      return "";
  }
  const thread_ts = response.data["messages"][0]["thread_ts"];
  if(!thread_ts) {
      console.log("invalid thread.");
      return;
  }
  var th  = await db.all(`SELECT ts as ts FROM thread where ts=?::DOUBLE`, thread_ts)
  if (th.length != 0) {
      return "";
  }
      console.log("adding new thread");
    await db.all(`
      Insert into thread (ts, channel_id)
      Values (
          ?::TEXT,
          ?::TEXT,
      ) ON CONFLICT DO NOTHING;
    `,
      thread_ts,
      msg.channel_id,
    );
      console.log("added new thread");
  const threadStruct: Thread = {
    ts: thread_ts,
    channel_id: msg.channel_id,
    reply_count: 0,
  };

  var next_cursor = await getThread(threadStruct, "");
  while (true) {
    if (next_cursor === undefined) {
        break;
    }
    if (next_cursor === null) {
      break;
    }
    if (next_cursor === "") {
      break;
    }
    await sleep(1000);
    next_cursor = await getThread(threadStruct, next_cursor);
    console.log(next_cursor);
  }
    } catch (err) {
        console.log("error load_thread", err);
        throw err;
    }
}

async function getThread(thread: Thread, cursor: string) {
  const db = await getDB();
  const threadURL = "https://slack.com/api/conversations.replies";
  try {
    const threadParams = {
      channel:  thread.channel_id,
      ts: thread.ts,
      cursor: cursor,
    };
    var response = await axios.get(threadURL, { headers, params: threadParams })
    if (!response.data["messages"] || response.data["messages"].length == 0) {
        console.log("no messages in thread");
        return "";
    }
    if (cursor === "") {
      const reply_count = response.data["messages"][0]["reply_count"];
      db.all(`
        update thread
        set reply_count = ?::INT
        where ts = ?::DOUBLE;
      `, reply_count, thread.ts);
    }
    console.log(response.data["messages"].length);
    response.data["messages"].forEach( async (mesg: any) => {
      const msgStruct: Message = {
        ts: mesg["ts"],
        thread_ts: thread.ts,
        channel_id: thread.channel_id,
        text: mesg["text"],
        user_id: mesg["bot_id"] ? mesg["bot_id"] : mesg["user"],
        link: "",
        by_bot: mesg["bot_id"] ? true : false,
      }
      msgStruct.link = construct_permalink(msgStruct);
      try {
        await insert_message(msgStruct);
      } catch (err) {
        console.error('Error inserting message:', err);
      }
    });
  } catch (err) {
    console.error('Error inserting data:', err);
    return "";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
function construct_permalink(msg: Message) {
  return `https://hasurahq.slack.com/archives/${msg.channel_id}/p${msg.ts*1000000}?thread_ts=${msg.thread_ts}&cid=${msg.channel_id}`;
}
