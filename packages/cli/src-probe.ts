import { NodeRuntime, NodeServices } from "@effect/platform-node"
import { Console, Effect, Option } from "effect"
import { Argument, Command, Flag } from "effect/cli"
const root = Command.make("shot", { target: Argument.String("target").pipe(Argument.optional), click: Flag.String("click").pipe(Flag.atLeast(0)), mode: Flag.String("mode").pipe(Flag.optional) },
  ({ target, click, mode }) => Console.log("root", target, click, mode))
const login = Command.make("login", { as: Flag.String("as") }, ({ as }) => Console.log("login", as))
root.pipe(Command.withSubcommands([login]), Command.run({ version: "0" }), Effect.provide(NodeServices.layer), NodeRuntime.runMain)
