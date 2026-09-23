import { Scene } from "phaser";
import { authorizeDiscordUser } from "../utils/discordSDK";
import { connectToGame } from "../net/connection";
import { createButton, createTitle } from "../ui/widgets";
import { GlobalAudio } from "../sound";

export class Title extends Scene {
  constructor() {
    super("Title");
  }

  preload() {
    GlobalAudio.loadFiles(this);
  }

  create(data?: { message?: string }) {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;

    createTitle(this,500,200,200);

    // shows connection errors, or why we were sent back here (e.g. a lost connection)
    const status = this.add.text(w/2,h/2+150,data?.message ?? "",{
      fontFamily: "Arial",
      fontSize: 22,
      color: "#ff8080",
      align: "center",
    }).setOrigin(0.5);

    const start = createButton(this,w/2,h/2+60,"Start",async () => {
      start.setEnabled(false);
      start.setLabel("Joining...");
      status.setColor("#cccccc").setText("");
      try {
        console.log("On Start Click");
        await authorizeDiscordUser();
        console.log("After auth disc");
        const room = await connectToGame(w,h);
        console.log("connected to game");
        // late joiners go straight to spectating if a match is already running
        this.scene.start(room.state.phase === "match" ? "ScorchMatch" : "MainMenu");
      } catch (e) {
        console.error(e);
        status.setColor("#ff8080").setText(`Could not join: ${e instanceof Error ? e.message : e}`);
        start.setLabel("Start");
        start.setEnabled(true);
      }
    });
  }
}
