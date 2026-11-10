// Child process: commit one movement per transaction forever; after each COMMIT, append the id to the ack file.
import { appendFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { openDb } from './driver.mjs';
const [, , dbPath, ackPath, driver, sync] = process.argv;
const db = openDb(dbPath, driver, sync);
for (;;) {
  const id = randomUUID();
  db.exec('BEGIN');
  db.run('INSERT INTO movements(id,item,qty,at) VALUES(?,?,?,?)', id, 'item-' + (Math.random() * 50 | 0), -1, Date.now());
  db.run('INSERT INTO movements(id,item,qty,at) VALUES(?,?,?,?)', id + ':pair', 'item-x', 1, Date.now()); // second row in same txn: must never be seen alone
  db.exec('COMMIT');
  appendFileSync(ackPath, id + '\n');
}
