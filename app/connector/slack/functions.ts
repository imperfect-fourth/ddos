import * as sdk from "@hasura/ndc-lambda-sdk"
import { getDB } from "@hasura/ndc-duckduckapi";
import { load_threads_for_user, load_messages_from_user } from "./index";
//import * as fs from 'fs';
//
//export function setCurrentUser(id: string) {
//    if (id === "") {
//        throw new Error("empty id not allowed");
//    }
//    checkExists();
//    fs.writeFileSync("/etc/connector/persist-data/user.txt", id)
//    return `hello ${id}`;
//}
//
///**
// * @readonly Exposes the function as an NDC function (the function should only query data without making modifications)
// */
//export function whoami() {
//    checkExists();
//    const id = fs.readFileSync("/etc/connector/persist-data/user.txt", "utf-8")
//    return `hello ${id}`;
//}
//
///**
// * @readonly Exposes the function as an NDC function (the function should only query data without making modifications)
// */
//export function getCurrentUser() {
//    return whoami();
//}
//
//function checkExists() {
//    if (!fs.existsSync("/etc/connector/persist-data")) {
//        fs.mkdirSync("/etc/connector/persist-data");
//    }
//}
//

export var tracked_users: Map<string, number> = new Map();
export const seconds_in_week = 604800*2;

export async function track_user(user_id: string) {
  const db = await getDB();
  var user = await db.all(`SELECT display_name as display_name FROM user where id=?::TEXT`, user_id);
  if (user.length !== 0) {
      var display_name =  user[0]["display_name"];
      if ((tracked_users.get(display_name) ?? 0) !== 0) {
        throw new sdk.UnprocessableContent(`user with id ${user_id} is already tracked`);
      }
      tracked_users.set(display_name, (Date.now()/1000)-seconds_in_week);
      load_threads_for_user(display_name);
      //load_messages_from_user(display_name);
      return `tracking user ${display_name}. loading the messages will take a couple of minutes.`;
  } else {
      throw new sdk.UnprocessableContent(`user with id ${user_id} doesn't exist`);
  }
}
