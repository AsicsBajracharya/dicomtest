import {
  Enums,
  RenderingEngine,
  init as csInit,
  volumeLoader,
  type Types,
  cache,
  metaData,
  cornerstoneStreamingImageVolumeLoader
} from "@cornerstonejs/core";
// import regis
import {
  wadouri,
  init as dicomLoaderInit,
  // metaDataProvider as dicomMetaDataProvider
  // external as dicomExternal
} from "@cornerstonejs/dicom-image-loader";

import {
  init as csToolsInit,
  addTool,
  ToolGroupManager,
  Enums as csToolsEnums,
  CrosshairsTool,
  StackScrollTool,
  WindowLevelTool,
  PanTool,
  ZoomTool,
} from '@cornerstonejs/tools';

import dicomMetaDataProvider from "@cornerstonejs/dicom-image-loader/wadouri/metaData/metaDataProvider";
import JSZip from "jszip";
import { useRef, useState, useEffect } from "react";
// import './App.css'

const ENGINE_ID = "mprEngine";
const VOLUME_ID = 'cornerstoneStreamingImageVolume:zipVolume';
const toolGroupId = "reactToolGroup";

function App() {
  const [fileState, setFileState] = useState<String>("");
  const [message, setMessage] = useState<String>("");
  const [error, setError] = useState<String>("");
  const viewportRef = useRef<HTMLDivElement>(null);
  const axialRef = useRef<HTMLDivElement>(null);
  const corRef = useRef<HTMLDivElement>(null);
  const sagRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<any>(null);

  useEffect(() => {
    (async () => {
      await csInit(); // Initialize Cornerstone Core
      await dicomLoaderInit(); // Initialize DICOM Loader
      metaData.addProvider(dicomMetaDataProvider, 10000);
      // metaData.addProvider(dicomfileMetaDataProvider, 10001);

      // Register streaming loader (v4.5.x expects scheme + loader)
      const adapter: Parameters<typeof volumeLoader.registerVolumeLoader>[1] = (
        volumeId: string,
        options?: Record<string, unknown>
      ) => {
        const { imageIds, progressiveRendering } = (options ?? {}) as {
          imageIds: string[];
          progressiveRendering?: unknown;
        };
        if (!Array.isArray(imageIds) || imageIds.length === 0) {
          throw new Error("imageIds[] required");
        }
        return cornerstoneStreamingImageVolumeLoader(volumeId, {
          imageIds,
          progressiveRendering,
        });
      };
      volumeLoader.registerVolumeLoader(
        "cornerstoneStreamingImageVolume",
        adapter
      );

      console.log("Cornerstone initialized ✅");
    })();
  }, []);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (error) setError("");
    if (message) setMessage("");
    const file = e.target.files?.[0];

    if (!file) return;

    setFileState("loading");
    setMessage("Extracting zip...");

    try {
      const zip = await JSZip.loadAsync(file);
      const dicomFiles: File[] = [];

      for (const [filename, entry] of Object.entries(zip.files)) {
        if (filename.toLowerCase().endsWith(".dcm")) {
          const blob = await entry.async("blob");
          dicomFiles.push(new File([blob], filename));
        }
      }

      if (dicomFiles.length === 0) throw new Error("No DICOM files found");
      setMessage(`Found ${dicomFiles.length} DICOM files`);

      // Register files to fileManager

      // const imageIds = dicomFiles.map((file) => wadouri.fileManager.add(file));

      const imageIds = dicomFiles.map((file) => {
        const blobUrl = URL.createObjectURL(file);
        return `wadouri:${blobUrl}`;
      });

      

      const firstId = imageIds[0];
      console.log("firstId:", firstId); // must start with "wadouri:"

      console.log('imagePixelModule', metaData.get('imagePixelModule', firstId));

      setMessage('Creating streaming volume…');
      const volume = await volumeLoader.createAndCacheVolume(VOLUME_ID, {
        imageIds,
      });
      console.log("volume", volume);
      await volume.load();
      await renderThreeOrthos();
      // renderImages(imageIds);
      //   renderThreeOrthos(imageIds)
    } catch (err: unknown) {
      setMessage("");
      if (err instanceof Error) {
        console.error(err.message);
        setError(err.message);
      } else {
        console.error(String(err));
      }
    }
  };

  async function renderThreeOrthos() {
    if (!axialRef.current || !corRef.current || !sagRef.current) return;
  
    // Destroy any previous rendering engine to start clean
    if (engineRef.current) {
      try {
        engineRef.current.destroy();
      } catch {}
    }
  
    // Create a new rendering engine
    engineRef.current = new RenderingEngine(ENGINE_ID);
  
    // Define the 3 orthogonal viewports
    const defs = [
      { id: "AXIAL", el: axialRef.current, ori: Enums.OrientationAxis.AXIAL },
      { id: "CORONAL", el: corRef.current, ori: Enums.OrientationAxis.CORONAL },
      { id: "SAGITTAL", el: sagRef.current, ori: Enums.OrientationAxis.SAGITTAL },
    ];
  
    // Enable all three viewports
    for (const d of defs) {
      engineRef.current.enableElement({
        viewportId: d.id,
        type: Enums.ViewportType.ORTHOGRAPHIC,
        element: d.el,
        defaultOptions: { background: [0, 0, 0] },
      });
    }
  
    // Get references to each viewport
    const views = defs.map(
      (d) => engineRef.current.getViewport(d.id) as Types.IVolumeViewport
    );
  
    // Assign the same volume to all three
    await Promise.all(
      views.map((v) => v.setVolumes([{ volumeId: VOLUME_ID }]))
    );
  
    // Get the loaded volume from cache
    const volume = cache.getVolume(VOLUME_ID);
    if (!volume) {
      console.warn("Volume not found in cache");
      return;
    }
  
    // Compute reasonable VOI from voxel intensity range
    const { minPixelValue, maxPixelValue } = volume.voxelManager;
    const windowWidth = maxPixelValue - minPixelValue;
    const windowCenter = (maxPixelValue + minPixelValue) / 2;
  
    // Apply orientation, VOI, camera reset, and render for each view
    for (const [i, v] of views.entries()) {
      v.setOrientation(defs[i].ori);
  
      // @ts-expect-error Cornerstone accepts windowWidth/windowCenter at runtime
      v.setProperties({
        voiRange: { windowWidth, windowCenter },
      });
  
      v.resetCamera();
      v.render();
    }
    // wire tools after actors exist

    // ['AXIAL','CORONAL','SAGITTAL'].forEach(id => {
    //   const vp = engineRef.current.getViewport(id) as Types.IVolumeViewport;
    //   const actor = vp.getVolumeActor?.();
    //   console.log(id, 'has actor?', !!actor, actor?.getMapper?.()?.getInputData?.());
    // });
    // await wireToolsForMPR(engineRef.current);

    //TRY THIS WAY
    const renderingEngineId = ENGINE_ID; // you constructed the engine with this id
  const toolGroupId = 'MPR_TOOLGROUP';
  const viewportIds = ['AXIAL', 'CORONAL', 'SAGITTAL'];

  // Clean up any previous group so bindings don’t accumulate
  const prev = ToolGroupManager.getToolGroup(toolGroupId);
  if (prev) {
    try {
      viewportIds.forEach((vpId) => {
        try {
          prev.removeViewport(vpId, renderingEngineId);
        } catch {}
      });
      ToolGroupManager.destroyToolGroup(toolGroupId);
    } catch {}
  }

  // Create a fresh tool group
  const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);

  // Register tools (safe to call multiple times across the app lifecycle)
  addTool(WindowLevelTool);
  addTool(ZoomTool);
  addTool(PanTool);
  // Optional crosshairs for synchronized slicing between views
  // (Leave it enabled without mouse bindings to avoid conflicts)
  addTool(CrosshairsTool);

  // Add tools to the group
  toolGroup.addTool(WindowLevelTool.toolName);
  toolGroup.addTool(ZoomTool.toolName);
  toolGroup.addTool(PanTool.toolName);
  toolGroup.addTool(CrosshairsTool.toolName);

  // Bindings: LMB = WL, RMB = Zoom, MMB = Pan
  toolGroup.setToolActive(WindowLevelTool.toolName, {
    bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
  });
  toolGroup.setToolActive(ZoomTool.toolName, {
    bindings: [{ mouseButton: csToolsEnums.MouseBindings.Secondary }],
  });
  toolGroup.setToolActive(PanTool.toolName, {
    bindings: [{ mouseButton: csToolsEnums.MouseBindings.Auxiliary }],
  });

  // Enable crosshairs (no mouse bindings) and associate with the loaded volume
  toolGroup.setToolEnabled(CrosshairsTool.toolName);
  toolGroup.setToolConfiguration(CrosshairsTool.toolName, {
    volumeId: VOLUME_ID, // the same volume you set on the viewports
    slabThickness: 0.1,  // tweak to taste
  });

  // Attach ALL three viewports to the group
  viewportIds.forEach((vpId) => {
    toolGroup.addViewport(vpId, renderingEngineId);
  });
    console.log("🩻 All orthogonal views rendered successfully");
  }

  async function wireToolsForMPR(engine: RenderingEngine) {
    await csToolsInit();
  
    // Register tools (idempotent)
    [CrosshairsTool, StackScrollTool, WindowLevelTool, PanTool, ZoomTool].forEach(addTool);
  
    const tgId = 'mprToolGroup';
    const toolGroup =
      ToolGroupManager.getToolGroup(tgId) ?? ToolGroupManager.createToolGroup(tgId);
  
    // Add tools to group (idempotent)
    const ensureTool = (name: string) => {
      if (!toolGroup.getToolInstance(name)) toolGroup.addTool(name);
    };
    [
      CrosshairsTool.toolName,
      StackScrollTool.toolName,
      WindowLevelTool.toolName,
      PanTool.toolName,
      ZoomTool.toolName,
    ].forEach(ensureTool);
  
    // Tell Crosshairs exactly which viewports to sync
    toolGroup.setToolConfiguration(CrosshairsTool.toolName, {
      // for any source viewport, return the *other two* as targets
      getSynchronizedViewportsForViewport: (sourceViewportId: string, renderingEngineId: string) =>
        ['AXIAL', 'CORONAL', 'SAGITTAL']
          .filter((id) => id !== sourceViewportId)
          .map((viewportId) => ({ viewportId, renderingEngineId })),
      autoPan: true,
      autoJump: true,
    });
  
    // Bindings
    toolGroup.setToolActive(CrosshairsTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
    });
    toolGroup.setToolActive(WindowLevelTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Secondary }],
    });
    toolGroup.setToolActive(PanTool.toolName, {
      bindings: [{ mouseButton: csToolsEnums.MouseBindings.Auxiliary }],
    });
  
    // Wheel scrolling; if your build lacks Wheel binding, just setToolEnabled
    if ((csToolsEnums.MouseBindings as any).Wheel !== undefined) {
      toolGroup.setToolActive(StackScrollTool.toolName, {
        bindings: [{ mouseButton: (csToolsEnums.MouseBindings as any).Wheel }],
      });
    } else {
      toolGroup.setToolEnabled(StackScrollTool.toolName);
    }
  
    // IMPORTANT: attach viewports only AFTER they exist and have volumes
    const attach = (vpId: string) => toolGroup.addViewport(vpId, engine.id);
    attach('AXIAL');
    attach('CORONAL');
    attach('SAGITTAL');
  }

  return (
    <>
      <div
        ref={viewportRef}
        style={{
          width: "80vw",
          height: "70vh",
          backgroundColor: "#000",
          border: "2px solid #333",
        }}
      />
      <input
        type="file"
        name="zipUploader"
        onChange={handleFile}
        accept=".zip"
        className="border border-black"
      />
      <p>{message}</p>
      <p className="text-red-800">{error}</p>

      <div
        style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}
      >
        <div>
          <div style={{ marginBottom: 6, fontSize: 12, opacity: 0.9 }}>
            Axial View
          </div>
          <div
            ref={axialRef}
            style={{
              height: "70vh",
              background: "#000",
              border: "1px solid #333",
            }}
          />
        </div>
        <div>
          <div style={{ marginBottom: 6, fontSize: 12, opacity: 0.9 }}>
            Coronal View
          </div>
          <div
            ref={corRef}
            style={{
              height: "70vh",
              background: "#000",
              border: "1px solid #333",
            }}
          />
        </div>
        <div>
          <div style={{ marginBottom: 6, fontSize: 12, opacity: 0.9 }}>
            Sagittal View
          </div>
          <div
            ref={sagRef}
            style={{
              height: "70vh",
              background: "#000",
              border: "1px solid #333",
            }}
          />
        </div>
      </div>

      <input
        type="file"
        name="zipUploader"
        onChange={handleFile}
        accept=".zip"
      />
      <p>{message}</p>
      <p style={{ color: "#ff8b8b" }}>{error}</p>
    </>
  );
}

export default App;

