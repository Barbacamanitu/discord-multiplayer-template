import { Scene } from "phaser";


export interface TankAudioFiles {
    aim_loop: any;
}

export class GlobalAudio {
    private static _instance: GlobalAudio|null = null;
    tankFiles: TankAudioFiles;
    private constructor(tankFiles: TankAudioFiles) {
        this.tankFiles = tankFiles;
    }

    public instance(): GlobalAudio{
        if (GlobalAudio._instance == null) {
            throw new Error("Audio files not loaded yet.");
        }
        return GlobalAudio._instance;
    }


    public static loadFiles(s: Scene) {
        GlobalAudio.loadTankAudio(s);
    }

    private static loadTankAudio(s: Scene) {
        s.load.setPath("/.proxy/assets/audio/tank");
        const aiming_loop = s.load.audio("tank_aim1_loop","aim_loop.wav");
    }

}