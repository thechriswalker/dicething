// some sort of dynamic menu so we can "set" it from a child component and have it appear in the AppBar.

import type { Action } from "svelte/action";
import type { MenuData } from "../menu/menu";



let menuData = $state<MenuData>({});


export const menu: Action<HTMLElement, MenuData, {}> = (node, data) => {
    $effect(() => {
        // update the local state
        Object.entries(data).forEach(([key, value]) => {
            // we smash the existing data with new data
            menuData[key] = value;
        });

        return () => {
            //remove items from local state
            Object.keys(menuData).forEach(key => delete menuData[key]);
        };
    });
}

export const getMenuItems = () => menuData;