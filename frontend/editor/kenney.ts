// Kenney's models in the bundle (CC0, assets/models), grouped for the editor's library.
// Each is placed as the furniture type it is (for its plan symbol, lights and defaults).
// Sizes in metres come from the models (scripts/thumbnails.mjs writes kenney-sizes.json).

import type { FurnitureType } from "../model/types";
import SIZES from "./kenney-sizes.json";

export interface KenneyItem {
  file: string;
  type: FurnitureType;
}

const items = (type: FurnitureType, ...files: string[]): KenneyItem[] => files.map((file) => ({ file, type }));

export const KENNEY_GROUPS: { id: string; items: KenneyItem[] }[] = [
  {
    id: "living",
    items: [
      ...items("sofa", "loungeSofa", "loungeSofaLong", "loungeDesignSofa"),
      ...items("sofa_corner", "loungeSofaCorner", "loungeDesignSofaCorner"),
      ...items("armchair", "loungeChair", "loungeChairRelax", "loungeDesignChair"),
      ...items("stool", "loungeSofaOttoman"),
      ...items("coffee_table", "tableCoffee", "tableCoffeeSquare", "tableCoffeeGlass", "tableCoffeeGlassSquare"),
      ...items("side_table", "sideTable", "sideTableDrawers"),
      ...items("tv", "televisionModern", "televisionVintage"),
      ...items("shelf", "cabinetTelevision", "cabinetTelevisionDoors", "bookcaseOpen", "bookcaseOpenLow", "bookcaseClosed", "bookcaseClosedWide"),
      ...items("rug", "rugRectangle", "rugRounded", "rugRound", "rugSquare", "rugDoormat"),
      ...items("item", "speaker", "speakerSmall", "radio", "coatRackStanding", "books"),
    ],
  },
  {
    id: "dining",
    items: [
      ...items("table", "table", "tableCloth", "tableCross", "tableCrossCloth", "tableGlass", "tableRound"),
      ...items("chair", "chair", "chairCushion", "chairModernCushion", "chairModernFrameCushion", "chairRounded"),
      ...items("stool", "stoolBar", "stoolBarSquare"),
    ],
  },
  {
    id: "kitchen",
    items: [
      ...items("kitchen", "kitchenCabinet", "kitchenCabinetDrawer", "kitchenSink", "kitchenStove", "kitchenStoveElectric", "kitchenCabinetCornerInner", "kitchenCabinetCornerRound", "kitchenBar", "kitchenBarEnd"),
      ...items("kitchen_upper", "kitchenCabinetUpper", "kitchenCabinetUpperDouble", "kitchenCabinetUpperLow", "kitchenCabinetUpperCorner", "hoodModern", "hoodLarge"),
      ...items("fridge", "kitchenFridge", "kitchenFridgeLarge", "kitchenFridgeSmall", "kitchenFridgeBuiltIn"),
      ...items("item", "kitchenMicrowave", "kitchenCoffeeMachine", "kitchenBlender", "toaster", "trashcan"),
    ],
  },
  {
    id: "bedroom",
    items: [
      ...items("bed", "bedDouble"),
      ...items("bed_single", "bedSingle", "bedBunk"),
      ...items("nightstand", "cabinetBed", "cabinetBedDrawer", "cabinetBedDrawerTable"),
      ...items("wardrobe", "bookcaseClosedDoors"),
      ...items("desk", "desk", "deskCorner"),
      ...items("chair", "chairDesk"),
      ...items("item", "computerScreen", "laptop", "coatRack"),
    ],
  },
  {
    id: "bathroom",
    items: [
      ...items("bathtub", "bathtub"),
      ...items("shower", "shower", "showerRound"),
      ...items("toilet", "toilet", "toiletSquare"),
      ...items("sink", "bathroomSink", "bathroomSinkSquare"),
      ...items("shelf", "bathroomCabinet", "bathroomCabinetDrawer"),
      ...items("mirror", "bathroomMirror"),
    ],
  },
  { id: "utility", items: [...items("washer", "washer", "washerDryerStacked"), ...items("dryer", "dryer")] },
  {
    id: "lighting",
    items: [
      ...items("floor_lamp", "lampSquareFloor", "lampRoundFloor"),
      ...items("table_lamp", "lampSquareTable", "lampRoundTable"),
      ...items("ceiling_lamp", "lampSquareCeiling"),
      ...items("wall_lamp", "lampWall"),
      ...items("ceiling_fan", "ceilingFan"),
    ],
  },
  {
    id: "plants",
    items: [...items("plant", "pottedPlant", "plantSmall1", "plantSmall2", "plantSmall3")],
  },
  {
    id: "outside",
    items: [
      ...items("tree", "tree_oak_dark", "tree_oak", "tree_default_dark", "tree_detailed", "tree_fat", "tree_tall_dark", "tree_oak_fall", "tree_palmTall"),
      ...items("tree_small", "tree_default", "tree_small_dark", "tree_simple_dark", "tree_cone_dark", "tree_thin_dark"),
      ...items("pine", "tree_pineRoundC", "tree_pineTallA_detailed", "tree_pineDefaultA", "tree_pineSmallA"),
      ...items("bush", "plant_bushDetailed", "plant_bushLarge", "plant_bush", "plant_bushSmall"),
      ...items("flower_bed", "flower_redA", "flower_yellowA", "flower_purpleA", "flower_redC", "flower_yellowC", "flower_purpleC", "lily_large"),
      ...items("fence", "fence_simple", "fence_planks", "fence_planksDouble", "fence_simpleHigh", "fence_gate"),
      ...items("garden_path", "path_stone", "path_stoneCircle", "path_wood"),
      ...items("item", "stump_round", "log_stack"),
      ...items("bench", "bench", "benchCushion", "benchCushionLow"),
      ...items("car", "sedan", "suv", "suv-luxury", "hatchback-sports", "van", "delivery", "taxi", "police"),
    ],
  },
];

export const KENNEY_ITEMS: KenneyItem[] = KENNEY_GROUPS.flatMap((g) => g.items);

/** A model's size in metres: width, depth and height (null if not measured yet). */
export function kenneySize(file: string): { size: [number, number]; height: number } | null {
  const s = (SIZES as Record<string, number[]>)[file];
  return s?.length === 3 ? { size: [s[0], s[1]], height: s[2] } : null;
}
