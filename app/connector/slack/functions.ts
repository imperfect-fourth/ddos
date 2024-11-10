import * as sdk from "@hasura/ndc-lambda-sdk"
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

export var tracked_users: Map<string, number>;
const seconds_in_week = 604800;

export function track_user(user_id: string) {
  var user = await db.all(`SELECT display_name as display_name FROM user where id=?::TEXT`, uesr_id);
  if (user.length !== 0) {
      tracked_users.set(user["display_name"], Date.now()-seconds_in_week);
  } else {
      throw new sdk.UnprocessableContent(`user with id ${user_id} doesn't exist.`);
  }
}
