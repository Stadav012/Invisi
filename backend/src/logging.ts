/** Minimal structured logger. */
export default function logging(module: string) {
    const fmt = (level: string, msg: string) =>
        `${new Date().toISOString()} [${level}] [${module}] ${msg}`;

    return {
        info: (msg: string) => console.log(fmt("INFO", msg)),
        error: (msg: string) => console.error(fmt("ERROR", msg)),
    };
}
