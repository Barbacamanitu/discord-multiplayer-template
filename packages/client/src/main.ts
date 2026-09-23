import { ScaleFlow } from "./utils/ScaleFlow";
import { initiateDiscordSDK } from "./utils/discordSDK";

import { Boot } from "./scenes/Boot";
import { Game } from "./scenes/Game";
import { MainMenu } from "./scenes/MainMenu";
import { Title } from "./scenes/Title";
import { ScorchMatch } from "./scenes/ScorchMatch";
import { Preloader } from "./scenes/Preloader";
import { Background } from "./scenes/Background";

(async () => {
  // errors resurface when Start calls authorizeDiscordUser(), which shows them on the Title screen
  initiateDiscordSDK().catch(console.error);

  new ScaleFlow({
    type: Phaser.AUTO,
    parent: "gameParent",
    width: 1280, // this must be a pixel value
    height: 720, // this must be a pixel value
    backgroundColor: "#000000",
    roundPixels: false,
    pixelArt: false,
    scene: [Boot, Preloader, Title, MainMenu, ScorchMatch, Game, Background],
  });
})();
