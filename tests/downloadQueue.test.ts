import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DownloadQueue } from "../src/services/downloadQueue.js";

describe("DownloadQueue with Per-User Limits", () => {
  it("executes tasks with concurrency 1", async () => {
    const queue = new DownloadQueue(1, 5, 2);
    const order: number[] = [];

    const task1 = queue.add(async () => {
      await new Promise((r) => setTimeout(r, 20));
      order.push(1);
      return 1;
    }, "user1");

    const task2 = queue.add(async () => {
      order.push(2);
      return 2;
    }, "user2");

    await Promise.all([task1, task2]);
    assert.deepEqual(order, [1, 2]);
  });

  it("blocks user from queuing more than allowed jobs simultaneously", async () => {
    const queue = new DownloadQueue(1, 10, 1);

    // User 1 starts job
    const job1Promise = queue.add(async () => {
      await new Promise((r) => setTimeout(r, 50));
      return "done";
    }, "floodUser");

    // User 1 immediately attempts second job
    await assert.rejects(
      async () => {
        await queue.add(async () => "job2", "floodUser");
      },
      (err: Error) => {
        assert.ok(err.message.includes("شما هم‌اکنون یک دانلود در حال پردازش"));
        return true;
      }
    );

    await job1Promise;

    // After job 1 completes, user 1 can queue again
    const job3 = await queue.add(async () => "job3", "floodUser");
    assert.equal(job3, "job3");
  });
});
