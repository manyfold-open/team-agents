import type { Metadata } from "next";
import { TeamAgentsApp } from "./team-agents";

export const metadata: Metadata = {
  title: "Team Agents — Work with people and A2A agents",
  description: "A bilingual channel workspace where people and A2A agents collaborate in real time.",
};

export default function Home() {
  return <TeamAgentsApp />;
}
