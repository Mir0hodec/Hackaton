#!/usr/bin/env python3
"""Generate the small dependency-free Xcode project using stable PBX identifiers."""
from pathlib import Path
import hashlib
root=Path(__file__).resolve().parents[1]
def uid(name): return hashlib.sha256(name.encode()).hexdigest()[:24].upper()
files=['AppDelegate.swift','LANDiscovery.swift','LANViewController.swift','Info.plist','Assets.xcassets']
lines=['// !$*UTF8*$!','{',' archiveVersion = 1;',' classes = {};',' objectVersion = 56;',' objects = {']
def entry(name,body):lines.append(f'  {uid(name)} = {{ {body} }};')
for f in files:
 kind='sourcecode.swift' if f.endswith('.swift') else 'text.plist.xml' if f.endswith('.plist') else 'folder.assetcatalog'
 entry(f'file:{f}',f'isa = PBXFileReference; lastKnownFileType = {kind}; path = "{f}"; sourceTree = "<group>";')
 if f.endswith('.swift') or f.endswith('.xcassets'):entry(f'build:{f}',f'isa = PBXBuildFile; fileRef = {uid("file:"+f)};')
entry('product','isa = PBXFileReference; explicitFileType = wrapper.application; includeInIndex = 0; path = NaryadAI.app; sourceTree = BUILT_PRODUCTS_DIR;')
entry('group:source','isa = PBXGroup; children = ('+','.join(uid('file:'+f) for f in files)+',); path = NaryadAI; sourceTree = "<group>";')
entry('group:products',f'isa = PBXGroup; children = ({uid("product")},); name = Products; sourceTree = "<group>";')
entry('group:root',f'isa = PBXGroup; children = ({uid("group:source")},{uid("group:products")},); sourceTree = "<group>";')
entry('phase:sources','isa = PBXSourcesBuildPhase; buildActionMask = 2147483647; files = ('+','.join(uid('build:'+f) for f in files if f.endswith('.swift'))+',); runOnlyForDeploymentPostprocessing = 0;')
entry('phase:resources',f'isa = PBXResourcesBuildPhase; buildActionMask = 2147483647; files = ({uid("build:Assets.xcassets")},); runOnlyForDeploymentPostprocessing = 0;')
entry('phase:frameworks','isa = PBXFrameworksBuildPhase; buildActionMask = 2147483647; files = (); runOnlyForDeploymentPostprocessing = 0;')
for mode in ['Debug','Release']:
 project='CLANG_ENABLE_MODULES = YES; SDKROOT = iphoneos; IPHONEOS_DEPLOYMENT_TARGET = 15.0; SWIFT_VERSION = 5.0; SWIFT_STRICT_CONCURRENCY = minimal; '
 project+='SWIFT_OPTIMIZATION_LEVEL = "-Onone"; DEBUG_INFORMATION_FORMAT = dwarf;' if mode=='Debug' else 'SWIFT_OPTIMIZATION_LEVEL = "-O"; DEBUG_INFORMATION_FORMAT = "dwarf-with-dsym";'
 entry('project:'+mode,'isa = XCBuildConfiguration; buildSettings = { '+project+' }; name = '+mode+';')
 target='ASSETCATALOG_COMPILER_APPICON_NAME = AppIcon; CODE_SIGN_STYLE = Automatic; CURRENT_PROJECT_VERSION = 1; GENERATE_INFOPLIST_FILE = NO; INFOPLIST_FILE = NaryadAI/Info.plist; MARKETING_VERSION = 1.0.0; PRODUCT_BUNDLE_IDENTIFIER = ai.naryad.ios; PRODUCT_NAME = "$(TARGET_NAME)"; SUPPORTED_PLATFORMS = "iphoneos iphonesimulator"; TARGETED_DEVICE_FAMILY = "1,2"; ENABLE_BITCODE = NO; '
 entry('target:'+mode,'isa = XCBuildConfiguration; buildSettings = { '+target+' }; name = '+mode+';')
for owner in ['project','target']:entry('configs:'+owner,f'isa = XCConfigurationList; buildConfigurations = ({uid(owner+":Debug")},{uid(owner+":Release")},); defaultConfigurationIsVisible = 0; defaultConfigurationName = Release;')
entry('target',f'isa = PBXNativeTarget; buildConfigurationList = {uid("configs:target")}; buildPhases = ({uid("phase:sources")},{uid("phase:frameworks")},{uid("phase:resources")},); buildRules = (); dependencies = (); name = NaryadAI; productName = NaryadAI; productReference = {uid("product")}; productType = "com.apple.product-type.application";')
entry('project',f'isa = PBXProject; attributes = {{ LastUpgradeCheck = 2600; }}; buildConfigurationList = {uid("configs:project")}; compatibilityVersion = "Xcode 14.0"; developmentRegion = ru; hasScannedForEncodings = 0; knownRegions = (ru,en,Base,); mainGroup = {uid("group:root")}; productRefGroup = {uid("group:products")}; projectDirPath = ""; projectRoot = ""; targets = ({uid("target")},);')
lines+=[' };',' rootObject = '+uid('project')+';','}']
(root/'NaryadAI.xcodeproj/project.pbxproj').write_text('\n'.join(lines)+'\n')
scheme=f'''<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2600" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries><BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid('target')}" BuildableName="NaryadAI.app" BlueprintName="NaryadAI" ReferencedContainer="container:NaryadAI.xcodeproj"/></BuildActionEntry></BuildActionEntries></BuildAction>
<LaunchAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" launchStyle="0" useCustomWorkingDirectory="NO" ignoresPersistentStateOnLaunch="NO" debugDocumentVersioning="YES" allowLocationSimulation="YES"><BuildableProductRunnable runnableDebuggingMode="0"><BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="{uid('target')}" BuildableName="NaryadAI.app" BlueprintName="NaryadAI" ReferencedContainer="container:NaryadAI.xcodeproj"/></BuildableProductRunnable></LaunchAction>
<AnalyzeAction buildConfiguration="Debug"/><ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
'''
(root/'NaryadAI.xcodeproj/xcshareddata/xcschemes/NaryadAI.xcscheme').write_text(scheme)
