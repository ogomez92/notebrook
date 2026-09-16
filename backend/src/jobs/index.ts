import { describeImageJob } from "./describe-image";
import { pushNotificationsJob } from "./push-notifications";
import { scheduleVacuum } from "./vacuum";

export const jobs = [
    scheduleVacuum,
    describeImageJob,
    pushNotificationsJob
]
