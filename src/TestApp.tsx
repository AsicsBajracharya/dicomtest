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
  init as dicomLoaderInit,
  // metaDataProvider as dicomMetaDataProvider
  // external as dicomExternal
} from "@cornerstonejs/dicom-image-loader";

import {
  addTool,
  ToolGroupManager,
  Enums as csToolsEnums,
  CrosshairsTool,
  WindowLevelTool,
  PanTool,
  ZoomTool,
  init as toolsInit
} from '@cornerstonejs/tools';

import dicomMetaDataProvider from "@cornerstonejs/dicom-image-loader/wadouri/metaData/metaDataProvider";
import JSZip from "jszip";
import { useRef, useState, useEffect } from "react";
// import './App.css'

const ENGINE_ID = "mprEngine";
const VOLUME_ID = 'cornerstoneStreamingImageVolume:zipVolume';

function App() {
  const [message, setMessage] = useState<String>("");
  const [error, setError] = useState<String>("");
  const axialRef = useRef<HTMLDivElement>(null);
  const corRef = useRef<HTMLDivElement>(null);
  const sagRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<any>(null);
  const dicomInitRef = useRef<boolean>(false)

  useEffect(() => {
    (async () => {
      try {
        await csInit(); // Initialize Cornerstone Core
        
        // Only initialize DICOM loader once globally
        if (!dicomInitRef.current) {
          await dicomLoaderInit(); // Initialize DICOM Loader
          dicomInitRef.current = true
          console.log("DICOM Loader initialized ✅");
        }
        
        await toolsInit();
        // Only add metadata provider if not already added
        try {
          metaData.addProvider(dicomMetaDataProvider, 10000);
          console.log("Metadata provider added ✅");
        } catch (error) {
          console.log("Metadata provider already registered");
        }
      // metaData.addProvider(dicomfileMetaDataProvider, 10001);

      // Register streaming loader (v4.5.x expects scheme + loader)
      // Only register if not already registered
      try {
        const adapter: Parameters<typeof volumeLoader.registerVolumeLoader>[1] = (
          volumeId: string,
          options?: Record<string, unknown>
        ) => {
          const { imageIds, progressiveRendering } = (options ?? {}) as {
            imageIds: string[];
            progressiveRendering?: boolean;
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
        console.log("Volume loader registered ✅");
      } catch (error) {
        console.log("Volume loader already registered");
      }

        console.log("Cornerstone initialized ✅");
      } catch (error) {
        console.error("Failed to initialize Cornerstone:", error);
      }
    })();
  }, []);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (error) setError("");
    if (message) setMessage("");
    const file = e.target.files?.[0];

    if (!file) return;

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
    const voxelManager = volume.voxelManager;
    if (!voxelManager || typeof voxelManager !== 'object') {
      console.warn('VoxelManager not available for VOI computation');
      return;
    }
    
    // For streaming volumes, we need to access the image data differently
    const imageIds = volume.imageIds;
    if (!imageIds || imageIds.length === 0) {
      console.warn('No image IDs available for VOI computation');
      return;
    }
    
    // Use default window/level values for now
    const windowWidth = 400;
    const windowCenter = 50;
  
    // Apply orientation, VOI, camera reset, and render for each view
    for (const [i, v] of views.entries()) {
      v.setOrientation(defs[i].ori);
  
      v.setProperties({
        voiRange: { 
          lower: windowCenter - windowWidth / 2,
          upper: windowCenter + windowWidth / 2
        },
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

  // Clean up any previous group so bindings don't accumulate
  const prev = ToolGroupManager.getToolGroup(toolGroupId);
  if (prev) {
    try {
      viewportIds.forEach((vpId) => {
        try {
          prev.removeViewports(renderingEngineId, vpId);
        } catch {}
      });
      ToolGroupManager.destroyToolGroup(toolGroupId);
    } catch {}
  }

  // Create a fresh tool group
  const toolGroup = ToolGroupManager.createToolGroup(toolGroupId);
  
  if (!toolGroup) {
    console.error('Failed to create tool group');
    return;
  }

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

  // Attach ALL three viewports to the group FIRST
  viewportIds.forEach((vpId) => {
    toolGroup.addViewport(vpId, renderingEngineId);
    console.log(`Attached viewport ${vpId} to tool group`);
  });
  
  // Verify viewports are attached
  const attachedViewports = toolGroup.getViewportIds();
  console.log('Attached viewports:', attachedViewports);

  // Configure crosshairs with proper viewport synchronization
  toolGroup.setToolConfiguration(CrosshairsTool.toolName, {
    volumeId: VOLUME_ID, // the same volume you set on the viewports
    slabThickness: 0.1,  // tweak to taste
    getSynchronizedViewportsForViewport: (sourceViewportId: string, renderingEngineId: string) =>
      viewportIds
        .filter((id) => id !== sourceViewportId)
        .map((viewportId) => ({ viewportId, renderingEngineId })),
    autoPan: true,
    autoJump: true,
  });

  // Enable crosshairs AFTER viewports are attached
  toolGroup.setToolEnabled(CrosshairsTool.toolName);

  // Bindings: LMB = WL, RMB = Zoom, MMB = Pan
  toolGroup.setToolActive(WindowLevelTool.toolName, {
    bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary }],
  });
  toolGroup.setToolActive(ZoomTool.toolName, {
    bindings: [{ mouseButton: (csToolsEnums.MouseBindings as any).Wheel }],
  });
  toolGroup.setToolActive(PanTool.toolName, {
    bindings: [{ mouseButton: csToolsEnums.MouseBindings.Primary, modifierKey: csToolsEnums.KeyboardBindings?.Alt as any }],
  });
    console.log("🩻 All orthogonal views rendered successfully");
  }


  return (
    <>
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
            onContextMenu={(e) => e.preventDefault()}
            style={{
              height: "70vh",
              background: "#000",
              border: "1px solid #333",
              touchAction: "none",
            }}
          />
        </div>
        <div>
          <div style={{ marginBottom: 6, fontSize: 12, opacity: 0.9 }}>
            Coronal View
          </div>
          <div
            ref={corRef}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              height: "70vh",
              background: "#000",
              border: "1px solid #333",
              touchAction: "none",
            }}
          />
        </div>
        <div>
          <div style={{ marginBottom: 6, fontSize: 12, opacity: 0.9 }}>
            Sagittal View
          </div>
          <div
            ref={sagRef}
            onContextMenu={(e) => e.preventDefault()}
            style={{
              height: "70vh",
              background: "#000",
              border: "1px solid #333",
              touchAction: "none",
            }}
          />
        </div>
      </div>
    </>
  );
}

export default App;

