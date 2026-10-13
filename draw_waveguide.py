import win32com.client
import sys

# Connect to the active CST Studio instance
try:
    cst = win32com.client.Dispatch("CSTStudio.Application")
    mws = cst.Active3D()
    if mws is None:
        # Fallback: Connect to the currently active MWS object
        mws = cst.ActiveMWS()

    if mws is None:
        print("Error: No active MWS found. Please make sure a 3D environment is open.")
        sys.exit(1)

    print(f"Connected to active MWS: {mws.GetProjectPath('Project')}")
except Exception as e:
    print(f"Failed to connect to CST: {e}")
    sys.exit(1)

# Step 1: Units
mws.AddToHistory("Setup_Units", """
With Units
    .Geometry "mm"
    .Frequency "GHz"
    .Time "ns"
End With
""")

# Step 2: Parameters
mws.AddToHistory("Store_Params", """
StoreParameter "a", "22.86"
StoreParameter "b", "10.16"
StoreParameter "length", "50"
StoreParameter "t_slab", "3"
StoreParameter "eps_r", "2.2"
""")

# Step 3: Frequency Range
mws.AddToHistory("Set_Frequency_Range", """
Solver.FrequencyRange "7.0", "11.0"
""")

# Step 4: Material
mws.AddToHistory("Dielectric_Material", """
With Material
    .Reset
    .Name "Dielectric_Material"
    .Epsilon "eps_r"
    .Mue "1.0"
    .Type "Normal"
    .Colour "0.2", "0.6", "0.9"
    .Create
End With
""")

# Step 5: Air Waveguide Brick
mws.AddToHistory("Air_Guide_Brick", """
With Brick
    .Reset
    .Name "Air_Guide"
    .Component "Guide"
    .Material "Vacuum"
    .Xrange "-a/2", "a/2"
    .Yrange "-b/2", "b/2"
    .Zrange "0", "length"
    .Create
End With
""")

# Step 6: Dielectric Slab Brick
mws.AddToHistory("Slab_Brick", """
With Brick
    .Reset
    .Name "Slab"
    .Component "Guide"
    .Material "Dielectric_Material"
    .Xrange "-t_slab/2", "t_slab/2"
    .Yrange "-b/2", "b/2"
    .Zrange "0", "length"
    .Create
End With
""")

# Step 7: Boolean Insert
mws.AddToHistory("Insert_Slab", """
Solid.Insert "Guide:Air_Guide", "Guide:Slab"
""")

# Step 8: Boundary Conditions
mws.AddToHistory("Boundary_Conditions", """
With Boundary
    .Xmin "electric"
    .Xmax "electric"
    .Ymin "electric"
    .Ymax "electric"
    .Zmin "expanded open"
    .Zmax "expanded open"
End With
""")

# Step 9 & 10: Waveguide Ports
mws.AddToHistory("Port_1", """
With Port
    .Reset
    .PortNumber "1"
    .Label "Port1"
    .NumberOfModes "2"
    .Coordinates "Free"
    .Orientation "zmin"
    .PortOnBound "True"
    .Xrange "-a/2", "a/2"
    .Yrange "-b/2", "b/2"
    .Zrange "0", "0"
    .Create
End With
""")

mws.AddToHistory("Port_2", """
With Port
    .Reset
    .PortNumber "2"
    .Label "Port2"
    .NumberOfModes "2"
    .Coordinates "Free"
    .Orientation "zmax"
    .PortOnBound "True"
    .Xrange "-a/2", "a/2"
    .Yrange "-b/2", "b/2"
    .Zrange "length", "length"
    .Create
End With
""")

print("Dielectric slab waveguide model created on the ACTIVE 3D environment!")
print("Please check the Component tree and the 3D graphics window.")
