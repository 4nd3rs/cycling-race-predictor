"use client";

import { useState, useEffect } from "react";
import { useUser } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Check, Loader2 } from "lucide-react";

interface FollowButtonProps {
  followType: "rider" | "race_event" | "team";
  entityId: string;
  entityName: string;
  className?: string;
}

export function FollowButton({ followType, entityId, entityName, className }: FollowButtonProps) {
  const { isSignedIn, isLoaded } = useUser();
  const router = useRouter();
  const [following, setFollowing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setLoading(false);
      return;
    }

    fetch(`/api/follows/check?followType=${followType}&entityId=${entityId}`)
      .then((res) => res.json())
      .then((data) => setFollowing(data.following))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isLoaded, isSignedIn, followType, entityId]);

  async function toggle() {
    if (!isSignedIn) {
      router.push("/sign-in");
      return;
    }

    setToggling(true);
    const newState = !following;
    setFollowing(newState); // optimistic

    try {
      const method = newState ? "POST" : "DELETE";
      const res = await fetch("/api/follows", {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ followType, entityId }),
      });
      if (!res.ok) {
        setFollowing(!newState); // revert
      }
    } catch {
      setFollowing(!newState); // revert
    } finally {
      setToggling(false);
    }
  }

  if (!isLoaded || loading) {
    return (
      <Button variant="outline" size="sm" disabled className={className}>
        <Loader2 className="h-3 w-3 animate-spin" />
      </Button>
    );
  }

  return (
    <Button
      variant={following ? "secondary" : "outline"}
      size="sm"
      onClick={toggle}
      disabled={toggling}
      className={className}
    >
      {following ? (
        <>
          <Check className="h-3 w-3 mr-1" />
          Following
        </>
      ) : (
        "Follow"
      )}
    </Button>
  );
}
