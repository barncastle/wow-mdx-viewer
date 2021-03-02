# WoW MDX Viewer
An Electron/TypeScript based model viewer for early World of Warcraft models that used the MDX format. See releases for x64 Windows binaries.

- This viewer supports v1300, 1400 and 1500 MDX files which were used by clients prior to 0.11.0.3925.
- Particles and ribbons are supported however they are a poor representation at best.
- Creature and character variations are supported but NPC variations and attachments are not.
- Bright pink textures are missing textures, this is the colour the above clients use.
- Lighting and render priority are not supported.

####Usage:

Run the application, select the red burger menu icon at the top left and select your target WoW directory. This will populate a tree view with all available models. Clicking the close button or the main screen will collapse this menu.

The viewer has controls for animation, texture variations, camera distance and height and the ability to toggle particles and ribbons. You can also adjust camera position with the scroll wheel for distance and shift + scroll wheel for height.

Additional controls for character styles are located in a collapsed menu at the bottom right, click the minus symbol to expand/collapse.

#### Editing:

- To run locally use the `start` script. This will build to the `./dist` directory and launch a local electron app.
- To publish use `pack` script. This will build to `./dist` then compile a distributable electron app to `./bin`. 
  - Currently this targets x64 Windows however can be modified for other [platforms](https://github.com/electron/electron-packager/blob/master/usage.txt).


#### Acknowledgements:

- [war3-model](https://github.com/4eb0da/war3-model): A Warcraft 3 model viewer that was used as the basis for rendering.
- [diablo2/mpq](https://github.com/blacha/diablo2/tree/master/packages/mpq): A MPQ reading library, that was forked, stripped back and zlib support added.
