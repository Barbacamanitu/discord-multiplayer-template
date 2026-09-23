import { Scene } from "phaser";

const BUTTON_COLOR = 0x2e7d32;
const BUTTON_HOVER_COLOR = 0x43a047;

export function createTitle(scene: Scene, width: number, height: number, yOffset = 0): Phaser.GameObjects.Container {
  const titleRect = scene.add.rectangle(width/2,height/2,width,height,Phaser.Display.Color.ValueToColor("#729785").color,0.9).setRounded(10);
  const titleText = scene.add.text(width/2,height/2,"Rurnt Earth",{
    fontFamily: "Arial Black",
    fontSize: 50,
    color: "#fffafa",
    stroke: "#00cc00",
    strokeThickness: 8,
    align: "center",
  }).setOrigin(0.5);

  return scene.add.container(scene.cameras.main.width/2-width/2,scene.cameras.main.height/2-height/2-yOffset,[titleRect,titleText]);
}

export interface Button {
  container: Phaser.GameObjects.Container;
  setLabel(label: string): void;
  setEnabled(enabled: boolean): void;
}

export interface ButtonOptions {
  fontSize?: number;
  // keep calling onClick every repeatMs while the button is held (after an initial delay)
  repeatMs?: number;
}

export function createButton(scene: Scene, x: number, y: number, label: string, onClick: () => void, width = 220, height = 70, options: ButtonOptions = {}): Button {
  const bg = scene.add.rectangle(0,0,width,height,BUTTON_COLOR).setStrokeStyle(4,0x000000).setRounded(10);
  const text = scene.add.text(0,0,label,{
    fontFamily: "Arial Black",
    fontSize: options.fontSize ?? 32,
    color: "#ffffff",
    stroke: "#000000",
    strokeThickness: 4,
  }).setOrigin(0.5);
  let repeat: Phaser.Time.TimerEvent | undefined;
  const stopRepeat = () => {
    repeat?.remove();
    repeat = undefined;
  };
  bg.setInteractive({ useHandCursor: true })
    .on("pointerover", () => bg.setFillStyle(BUTTON_HOVER_COLOR))
    .on("pointerout", () => {
      bg.setFillStyle(BUTTON_COLOR);
      stopRepeat();
    })
    .on("pointerup", stopRepeat)
    .on("pointerdown", () => {
      onClick();
      if (options.repeatMs) {
        stopRepeat();
        repeat = scene.time.delayedCall(300, () => {
          repeat = scene.time.addEvent({ delay: options.repeatMs, loop: true, callback: onClick });
        });
      }
    });

  return {
    container: scene.add.container(x,y,[bg,text]),
    setLabel: (next) => text.setText(next),
    setEnabled: (enabled) => {
      if (enabled) {
        bg.setInteractive({ useHandCursor: true });
      } else {
        bg.disableInteractive().setFillStyle(BUTTON_COLOR);
        stopRepeat();
      }
      bg.setAlpha(enabled ? 1 : 0.4);
      text.setAlpha(enabled ? 1 : 0.4);
    },
  };
}
