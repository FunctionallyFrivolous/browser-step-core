export const sampleModels = [
  {
    name: "GDT_Hole_Str.step",
    url: new URL("./models/GDT_Hole_Str.step", import.meta.url).href,
  },
  {
    name: "multibodyTest.step",
    url: new URL("./models/multibodyTest.step", import.meta.url).href,
  },
  {
    name: "tester.step",
    url: new URL("./models/tester.step", import.meta.url).href,
  },
] as const;
