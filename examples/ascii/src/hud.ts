import { Camera, type System, type World } from "@dylanebert/shallot";
import { Ascii, AsciiStyle } from "@dylanebert/shallot-ascii";

export function hud(container: HTMLElement, world: World): () => void {
    const root = document.createElement("div");
    root.className = "ascii-hud";
    root.innerHTML = `<kbd>T</kbd><span class="style"></span>`;
    container.append(root);
    const label = root.querySelector<HTMLElement>(".style")!;
    const read: System = {
        name: "Hud/Read",
        group: "draw",
        update(world) {
            for (const camera of world.query([Camera, Ascii])) {
                label.textContent =
                    world.storage(Ascii).style.get(camera) === AsciiStyle.Filled
                        ? "Filled"
                        : "Silhouette";
            }
        },
    };
    world.addSystem(read);
    return () => {
        world.removeSystem(read);
        root.remove();
    };
}
