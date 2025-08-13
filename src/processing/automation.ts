import { clearLastUsedModel, getCurrentlyProcessingItem, lastJobExecutionTime } from "@/processing/queueWorker";
import { SD_API_HOST } from "@/constants";
import axios from "axios";

/**
 * Defines a Task that can be executed periodically.
 */
interface Task {
  /**
   * Returns the name of the task. This will be used to identify the task in logs and other places.
   */
  getName: () => string;
  /**
   * Returns the interval in milliseconds between each execution of the task.
   */
  getInterval: () => number;

  /**
   * A function to check if the task is enabled. Only enabled tasks will be executed.
   * Note: This will only be called at application startup. If a task is disabled at runtime,
   *  it will not be executed. Should a task need to be enabled after startup, the application
   *  should be restarted.
   */
  isEnabled: () => boolean;

  /**
   * The function to be executed when the task is triggered.
   */
  execute: () => Promise<void>;
}

class AutoUnloadForgeCheckpointTask implements Task {

  getName(): string {
    return "Automatically unload Forge checkpoints";
  }

  async execute(): Promise<void> {
    let needsUnload = false;
    const inactivityTime = process.env.CHECKPOINT_UNLOAD_INTERVAL || 10;
    if (getCurrentlyProcessingItem() !== null) {
      console.log("Currently processing an item, not unloading.");
      return;
    }
    if (lastJobExecutionTime === -1) {
      console.log("No jobs have been executed yet, this is still considered inactivity - marking for unload.");
      needsUnload = true;
    } else {
      const now = new Date();
      const lastJobExecution = new Date(lastJobExecutionTime);
      const timeSinceLastJob = now.getTime() - lastJobExecution.getTime();
      const timeSinceLastJobMinutes = Math.round(timeSinceLastJob / (1000 * 60));
      console.log(`Time since last job: ${timeSinceLastJobMinutes} minutes`);
      if (timeSinceLastJobMinutes > inactivityTime) {
        console.log(`Time since last job is greater than ${inactivityTime} minutes, marking for unload.`);
        needsUnload = true;
      } else {
        console.log(`Time since last job is less than ${inactivityTime} minutes, not unloading.`);
      }
    }

    if (needsUnload) {
      console.log("Requesting checkpoint unload from Forge");
      try {
        await axios.post(`${SD_API_HOST}/unload-checkpoint`);
        clearLastUsedModel();
        console.log("Checkpoint unload request sent to Forge");
      } catch (error) {
        console.error("Error unloading checkpoint from Forge:", error);
      }
    }
  }

  getInterval(): number {
    // This task executes every 5 minutes
    return 5 * 60 * 1000;
  }

  isEnabled(): boolean {
    const interval = process.env.CHECKPOINT_UNLOAD_INTERVAL || 0;
    return interval > 0;
  }

}

export class TaskManager {
  private tasks: Task[] = [];

  constructor() {
    console.log("Initializing TaskManager...");
    this.tasks.push(new AutoUnloadForgeCheckpointTask());

    this.tasks.forEach(task => {
      if (task.isEnabled()) {
        console.log(`Enabling task: ${task.getName()}`);
        setInterval(async () => {
          console.log(`Executing task: ${task.getName()}`);
          try {
            await task.execute();
            console.log(`Task ${task.getName()} executed successfully.`);
          } catch (error) {
            console.error(`Error executing task ${task.getName()}:`, error);
          }
        }, task.getInterval());
      }
    });
  }
}