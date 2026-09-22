import { Scene } from "phaser";
import { authorizeDiscordUser } from "../utils/discordSDK";
export class MainMenu extends Scene {
  constructor() {
    super("MainMenu");
  }

  private static readonly READY_COLOR = 0x33dd55;
  private static readonly NOT_READY_COLOR = 0xdd3333;
  private readyIndicators: Partial<Record<1|2, Phaser.GameObjects.Arc>> = {};
  private readyState: Record<1|2, boolean> = { 1: false, 2: false };

  private setPlayerReady(player: 1|2, ready: boolean) {
    this.readyState[player] = ready;
    this.readyIndicators[player]?.setFillStyle(ready ? MainMenu.READY_COLOR : MainMenu.NOT_READY_COLOR);
  }

  private createReadyButton(x: number, y: number, onClick: () => void): Phaser.GameObjects.Container {
    const bg = this.add.rectangle(0,0,220,70,0x2e7d32).setStrokeStyle(4,0x000000).setRounded(10);
    const text = this.add.text(0,0,"Ready",{
      fontFamily: "Arial Black",
      fontSize: 32,
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 4,
    }).setOrigin(0.5);
    bg.setInteractive({ useHandCursor: true })
      .on("pointerover", () => bg.setFillStyle(0x43a047))
      .on("pointerout", () => bg.setFillStyle(0x2e7d32))
      .on("pointerdown", onClick);
    return this.add.container(x,y,[bg,text]);
  }


  private createTitle(width: number, height: number,x?: number,y?: number): Phaser.GameObjects.Container {
    const titleRect = this.add.rectangle(width/2,height/2,width,height,Phaser.Display.Color.ValueToColor("#729785").color,0.9).setRounded(10);
    const titleText = this.add.text(width/2,height/2,"Rurnt Earth",{
      fontFamily: "Arial Black",
      fontSize: 50,
      color: "#fffafa",
      stroke: "#00cc00",
      strokeThickness: 8,
      align: "center",
    }).setOrigin(0.5);

    const titleContainer = this.add.container(this.cameras.main.width/2-width/2,this.cameras.main.height/2-height/2-(y ?? 0),[titleRect,titleText]);
    return titleContainer;
  }

  private createPlayerReadyup(player: 1|2, username: string,x = 0,y = 0) : Phaser.GameObjects.Container{
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
    const label = this.add.text(0,0,`Player ${player}: `,playerLabelStyle,).setOrigin(1,0.5);
    const nameVal = this.add.text(0,0,username,playerNameStyle).setOrigin(0,0.5);
    const indicator = this.add.circle(nameVal.width+20,0,10,MainMenu.NOT_READY_COLOR).setStrokeStyle(2,0x000000);
    this.readyIndicators[player] = indicator;
    const playerContainer = this.add.container(x,y,[label,nameVal,indicator]);
    return playerContainer
  }

  create() {
    // scene instances are reused on restart, so reset state here rather than relying on field initializers
    this.readyState = { 1: false, 2: false };
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;
    const hW = w/2;
    const hH = h/2;

    


    
    const c = this.createTitle(500,200,0,200);
    const p1= this.createPlayerReadyup(1,"Barbaca",hW,hH+50);
    const p2= this.createPlayerReadyup(2,"Hella",hW,hH+100);

    // TODO: toggle the local player once multiplayer is wired up; for now this is always Player 1
    this.createReadyButton(hW,h-80,() => this.setPlayerReady(1,!this.readyState[1]));
    //const playerNames = this.add.container(0,0,[p1,p2])

  }


}
