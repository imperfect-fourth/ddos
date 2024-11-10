// From original index.ts
import { start } from "@hasura/ndc-duckduckapi";
import { makeConnector, duckduckapi, getDB } from "@hasura/ndc-duckduckapi";
import * as path from "path";
import axios from 'axios';
import { tracked_users, seconds_in_week } from './functions';

var headers = { Authorization: "" };


const connectorConfig: duckduckapi = {
  dbSchema: `
    -- Add your SQL schema here.
    -- This SQL will be run on startup every time.
    DROP TABLE IF EXISTS message;
    DROP TABLE IF EXISTS channel;
    DROP TABLE IF EXISTS user;
    DROP TABLE IF EXISTS thread;
    CREATE TABLE channel (
        id text primary key,
        name text,
    );
    CREATE TABLE  user (
        id text primary key,
        username text,
        is_bot bool,
        real_name text,
        display_name text,
    );
    CREATE TABLE  thread (
        ts text primary key,
    );
    CREATE TABLE message (
        ts text primary key,
        text text,
        user varchar references user(id),
        channel varchar references channel(id),
        thread_ts text references thread(ts),
        link text,
    );
  `,
  functionsFilePath: path.resolve(__dirname, "./functions.ts"),
};

async function search_query(query: string, till_timestamp: number, cursor: string) {
  try {
    const db = await getDB();
    const searchURL = "https://slack.com/api/search.messages";
    const searchParams = {
      count: 100,
      highlight: false,
      sort: "timestamp",
      query: `${query}`,
      cursor: cursor;
    };
    var response = await axios.get(searchURL, { headers, params: searchParams });
    var messages = response.data["messages"]["matches"];
    for (var i = 0; i < messages.length; i++) {
      var msg = messages[i];
      if (msg["ts"] < till_timestamp) {
        return "";
      }
      var msgStruct: Message = {
        ts: msg["ts"],
        text: msg["text"],
        user: msg["user"],
        channel: msg["channel"]["id"],
        thread_ts: "",
        link: msg["link"],
      };
      await insert_channel(msg["channel"]["id"], msg["channel"]["name"]);
      await load_thread(msgStruct);

      if (response.data["response_metadata"]) {
        return response.data["response_metadata"]["next_cursor"];
      } else {
          return "";
      }
    }
  } catch (err) {
    console.error(`error search_query: ${err}`);
    throw err;
  }
}


async function load_messages_from_user_helper(user_display_name: string, cursor: string) {
  return await search_query(`from:@${user_display_name}`, tracked_users.get(user_display_name) ?? Date.now() - seconds_in_week, cursor) 
}

async function load_messages_from_user(user_display_name: string) {
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
    next_cursor = await load_messages_from_user_helper(msg, next_cursor);
  }
}

async function load_threads_for_user_helper(user_display_name: string, cursor: string) {
  return await search_query(`@${user_display_name}`, tracked_users[user_display_name], cursor) 
}

async function load_threads_for_user(user_display_name: string) {
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
    next_cursor = await load_threads_for_user_helper(msg, next_cursor);
  }
}

async function load_tracked_users() {
  setInterval(async () => {
    trackedUsers.forEach((val, key) => {
      trackedUntil = Date.Now();
      await load_thread_for_user(key);
      await load_messages_from_user(key);
      trackedUsers[key] = trackedUntil;
    });
  ), 1000000);
}

(async () => {
  const connector = await makeConnector(connectorConfig);
  start(connector);
  const slackAPIKey = process.env.SLACK_API_KEY;
  if (slackAPIKey == "") {
    throw new Error("SLACK_API_KEY env needs to be set.");
  }
  headers = { Authorization: `Bearer ${slackAPIKey}` };

  await load_users();
  load_tracked_users();
})();

type Message = {
    ts: string,
    text: string,
    user: string,
    channel: string,
    thread_ts: string,
    link: string,
}

async function insertMessage(msg: Message) {
  const db = await getDB();
  try {
    await db.all(`
      INSERT INTO message (ts, text, user, channel, thread_ts, link)
      VALUES (
          ?::TEXT,
          ?::TEXT,
          ?::VARCHAR,
          ?::VARCHAR,
          ?::TEXT,
          ?::TEXT,
      ) ON CONFLICT DO NOTHING;`,
      msg.ts,
      msg.text,
      msg.user,
      msg.channel,
      msg.thread_ts,
      msg.link,
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

async function loadUsers() {
  var next_cursor = await getUsers("");
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
    next_cursor = await getUsers(next_cursor);
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

async function getUsers(cursor: string) {
  const db = await getDB();
  const usersURL = "https://slack.com/api/users.list";
  try {
    const params = {
        cursor: cursor
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
            user.id,
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
  var next_cursor = await getThread(msg, "");
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
    next_cursor = await getThread(msg, next_cursor);
    console.log(next_cursor);
  }
}

async function getThread(msg: Message, cursor: string) {
  const db = await getDB();
  const threadURL = "https://slack.com/api/conversations.replies";
  try {
    var threadParams;

    if (cursor !== "") {
      threadParams = {
        channel:  msg.channel,
        ts: msg.ts,
        cursor: cursor,
      };
    } else {
      threadParams = {
        channel:  msg.channel,
        ts: msg.ts,
      };
    }
    var response = await axios.get(threadURL, { headers, params: threadParams })
    if (!response.data["messages"] || response.data["messages"].length == 0) {
        console.log("no messages in thread");
        return "";
    }
    const thread_ts = response.data["messages"][0].ts;
    if (cursor === "") {
      var th = await db.all(`SELECT ts as ts FROM thread where ts=?::TEXT`, thread_ts)
      if (th.length != 0) {
          return "";
      } else {
          console.log("adding new thread");
        await db.all(`
          Insert into thread (ts)
          Values (
              ?::TEXT,
          )`,
          thread_ts,
        );
          console.log("added new thread");
      }
    }

    response.data["messages"].forEach( async (mesg: any) => {
        console.log(mesg);
      const msgStruct: Message = {
          ts: mesg["ts"],
          thread_ts: thread_ts,
          channel: msg.channel,
          text: mesg["text"],
          user: mesg["user"],
          link: msg.link,
      }
      console.log(msgStruct);
      await insert_message(msgStruct);
    });
  } catch (err) {
    console.error('Error inserting data:', err);
    return "";
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
