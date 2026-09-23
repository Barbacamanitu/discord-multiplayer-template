import { Scene } from "phaser";
import { LobbyService, LobbySlot, LobbyState } from "../lobby/LobbyService";
import { ColyseusLobbyService } from "../lobby/ColyseusLobbyService";
import { Button, createButton, createTitle } from "../ui/widgets";

export class MainMenu extends Scene {
  constructor() {
    super("MainMenu");
  }

  private static readonly READY_COLOR = 0x33dd55;
  private static readonly NOT_READY_COLOR = 0xdd3333;
  private static readonly DISCONNECTED_COLOR = 0x888888;

  private lobby!: LobbyService;
  private slotRows: Phaser.GameObjects.Container[] = [];
  private pendingClaim: number | null = null;
  private transitioning = false;
  private readyButton!: Button;
  private leaveButton!: Button;
  private spectatorText!: Phaser.GameObjects.Text;
  private countdownText!: Phaser.GameObjects.Text;
  private statusText!: Phaser.GameObjects.Text;

  private localSlot(state: LobbyState): LobbySlot | undefined {
    return state.slots.find((s) => s.playerId === this.lobby.localPlayerId);
  }

  private createTextButton(x: number, label: string, style: Phaser.Types.GameObjects.Text.TextStyle, onClick: () => void): Phaser.GameObjects.Text {
    const color = style.color as string;
    return this.add.text(x,0,label,style).setOrigin(0,0.5)
      .setInteractive({ useHandCursor: true })
      .on("pointerover", function (this: Phaser.GameObjects.Text) { this.setColor("#ffe066"); })
      .on("pointerout", function (this: Phaser.GameObjects.Text) { this.setColor(color); })
      .on("pointerdown", onClick);
  }

  private createSlotRow(index: number, slot: LobbySlot, can: { claim: boolean; changeAi: boolean }, x = 0, y = 0) : Phaser.GameObjects.Container{
    const playerLabelStyle =  {
      fontFamily: "Arial Black",
      fontSize: 25,
      color: "#ff9900",
      stroke: "#ed00f5",
      strokeThickness: 2,
      align: "right",
    };
    const playerNameStyle =  {
      fontFamily: "Arial Black",
      fontSize: 25,
      color: "#53e78c",
      stroke: "#000000",
      strokeThickness: 1,
      align: "left",
    };
    const label = this.add.text(0,0,`Player ${index + 1}: `,playerLabelStyle,).setOrigin(1,0.5);

    if (slot.isAi) {
      const nameVal = this.add.text(0,0,"AI",{ ...playerNameStyle, color: "#66ccff" }).setOrigin(0,0.5);
      const indicator = this.add.circle(nameVal.width+20,0,10,MainMenu.READY_COLOR).setStrokeStyle(2,0x000000);
      const items: Phaser.GameObjects.GameObject[] = [label,nameVal,indicator];
      if (can.changeAi) {
        items.push(this.createTextButton(nameVal.width+45,"Remove",{ ...playerNameStyle, fontSize: 18, color: "#ff8080" },() => this.lobby.removeAi(index)));
      }
      return this.add.container(x,y,items);
    }

    if (slot.playerId) {
      const name = slot.connected ? slot.username ?? "" : `${slot.username} (reconnecting)`;
      const nameVal = this.add.text(0,0,name,{ ...playerNameStyle, color: slot.connected ? playerNameStyle.color : "#888888" }).setOrigin(0,0.5);
      const color = !slot.connected ? MainMenu.DISCONNECTED_COLOR : slot.ready ? MainMenu.READY_COLOR : MainMenu.NOT_READY_COLOR;
      const indicator = this.add.circle(nameVal.width+20,0,10,color).setStrokeStyle(2,0x000000);
      return this.add.container(x,y,[label,nameVal,indicator]);
    }

    if (this.pendingClaim === index) {
      const joining = this.add.text(0,0,"Joining...",{ ...playerNameStyle, color: "#cccccc" }).setOrigin(0,0.5);
      return this.add.container(x,y,[label,joining]);
    }

    const join = can.claim
      ? this.createTextButton(0,"Join match",{ ...playerNameStyle, color: "#ffffff" },() => this.claimSlot(index))
      : this.add.text(0,0,"Open",{ ...playerNameStyle, color: "#888888" }).setOrigin(0,0.5);
    const items: Phaser.GameObjects.GameObject[] = [label,join];
    // AI can fill an open slot even after you've claimed yours, so you can play against it (or watch AI vs AI)
    if (can.changeAi) {
      items.push(this.createTextButton(join.width+30,"AI",{ ...playerNameStyle, color: "#66ccff" },() => this.lobby.addAi(index)));
    }
    return this.add.container(x,y,items);
  }

  private goTo(key: string, data?: object) {
    // state changes can keep arriving before the scene actually shuts down
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
    if (state.phase === "match") {
      this.goTo("ScorchMatch");
      return;
    }

    const hW = this.cameras.main.width/2;
    const hH = this.cameras.main.height/2;
    const local = this.localSlot(state);
    const connected = state.connection === "connected";
    const can = {
      // one slot per player, and nobody can claim while a claim is in flight
      claim: connected && !local && this.pendingClaim === null,
      changeAi: connected && this.pendingClaim === null && state.phase === "lobby",
    };

    this.slotRows.forEach((row) => row.destroy());
    this.slotRows = state.slots.map((slot, i) => this.createSlotRow(i, slot, can, hW, hH + 50 + i*50));

    this.spectatorText
      .setY(hH + 50 + state.slots.length*50)
      .setText(state.spectators.length ? `Spectating: ${state.spectators.join(", ")}` : "");

    this.countdownText
      .setText(`Starting in ${state.countdown}`)
      .setVisible(state.phase === "countdown");

    this.statusText.setText(state.connection === "reconnecting" ? "Reconnecting..." : "");

    this.readyButton.setEnabled(connected && !!local);
    this.readyButton.setLabel(local?.ready ? "Unready" : "Ready");
    this.leaveButton.setEnabled(connected && !!local);
  }

  private async claimSlot(index: number) {
    if (this.pendingClaim !== null) {
      return;
    }
    this.pendingClaim = index;
    this.render(this.lobby.getState());
    const result = await this.lobby.claimSlot(index);
    // the scene may have shut down while the request was in flight
    if (!this.sys.isActive()) {
      return;
    }
    this.pendingClaim = null;
    if (result.ok === false) {
      console.warn(`Could not claim slot ${index + 1}: ${result.reason}`);
    }
    this.render(this.lobby.getState());
  }

  create() {
    // scene instances are reused on restart, so reset state here rather than relying on field initializers
    this.slotRows = [];
    this.pendingClaim = null;
    this.transitioning = false;

    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const hW = w/2;

    createTitle(this,500,200,200);

    this.spectatorText = this.add.text(hW,0,"",{
      fontFamily: "Arial",
      fontSize: 18,
      color: "#cccccc",
      align: "center",
      wordWrap: { width: w - 200 },
    }).setOrigin(0.5,0);

    this.countdownText = this.add.text(hW,h-160,"",{
      fontFamily: "Arial Black",
      fontSize: 40,
      color: "#ffe066",
      stroke: "#000000",
      strokeThickness: 6,
    }).setOrigin(0.5).setVisible(false);

    this.statusText = this.add.text(hW,20,"",{
      fontFamily: "Arial",
      fontSize: 20,
      color: "#ffcc66",
    }).setOrigin(0.5,0);

    this.readyButton = createButton(this,hW-125,h-80,"Ready",() => {
      const slot = this.localSlot(this.lobby.getState());
      if (slot) {
        this.lobby.setReady(!slot.ready);
      }
    });
    this.leaveButton = createButton(this,hW+125,h-80,"Leave",() => this.lobby.releaseSlot());

    this.lobby = new ColyseusLobbyService();
    const unsubscribe = this.lobby.onChange((state) => this.render(state));
    this.render(this.lobby.getState());

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      unsubscribe();
      this.lobby.dispose();
    });
  }
}
