import { Scene } from "phaser";
import { LobbyService, LobbyState } from "../lobby/LobbyService";
import { ColyseusLobbyService } from "../lobby/ColyseusLobbyService";
import { Button, createButton } from "../ui/widgets";

// Placeholder match: shows who's playing vs spectating. Gameplay goes here.
export class ScorchMatch extends Scene {
  constructor() {
    super("ScorchMatch");
  }

  private lobby!: LobbyService;
  private transitioning = false;
  private roleText!: Phaser.GameObjects.Text;
  private playersText!: Phaser.GameObjects.Text;
  private spectatorText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;
  private forfeitButton!: Button;

  private goTo(key: string, data?: object) {
    this.transitioning = true;
    this.scene.start(key, data);
  }

  private render(state: LobbyState) {
    if (this.transitioning) {
      return;
    }
    if (state.connection === "disconnected") {
      this.goTo("Title", { message: "Lost connection to the server" });
      return;
    }
    if (state.phase !== "match" && state.connection === "connected") {
      this.goTo("MainMenu");
      return;
    }

    const localIndex = state.slots.findIndex((s) => s.playerId === this.lobby.localPlayerId);
    this.roleText.setText(localIndex >= 0 ? `You are Player ${localIndex + 1}` : "Spectating");

    this.playersText.setText(
      state.slots
        .map((s, i) => `Player ${i + 1}: ${s.username ?? "?"}${s.connected ? "" : " (reconnecting)"}`)
        .join("\n")
    );
    this.spectatorText.setText(state.spectators.length ? `Spectating: ${state.spectators.join(", ")}` : "");
    this.statusText.setText(state.connection === "reconnecting" ? "Reconnecting..." : "");
    this.forfeitButton.container.setVisible(localIndex >= 0);
    this.forfeitButton.setEnabled(localIndex >= 0 && state.connection === "connected");
  }

  create() {
    this.transitioning = false;

    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const hW = w/2;

    this.add.text(hW,80,"Match in progress",{
      fontFamily: "Arial Black",
      fontSize: 50,
      color: "#fffafa",
      stroke: "#00cc00",
      strokeThickness: 8,
    }).setOrigin(0.5);

    this.roleText = this.add.text(hW,170,"",{
      fontFamily: "Arial Black",
      fontSize: 30,
      color: "#ffe066",
      stroke: "#000000",
      strokeThickness: 4,
    }).setOrigin(0.5);

    this.playersText = this.add.text(hW,h/2,"",{
      fontFamily: "Arial Black",
      fontSize: 25,
      color: "#53e78c",
      stroke: "#000000",
      strokeThickness: 1,
      align: "center",
      lineSpacing: 12,
    }).setOrigin(0.5);

    this.spectatorText = this.add.text(hW,h/2+120,"",{
      fontFamily: "Arial",
      fontSize: 18,
      color: "#cccccc",
      align: "center",
      wordWrap: { width: w - 200 },
    }).setOrigin(0.5,0);

    this.statusText = this.add.text(hW,20,"",{
      fontFamily: "Arial",
      fontSize: 20,
      color: "#ffcc66",
    }).setOrigin(0.5,0);

    this.forfeitButton = createButton(this,hW,h-80,"Forfeit",() => this.lobby.forfeit());

    this.lobby = new ColyseusLobbyService();
    const unsubscribe = this.lobby.onChange((state) => this.render(state));
    this.render(this.lobby.getState());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unsubscribe();
      this.lobby.dispose();
    });
  }
}
