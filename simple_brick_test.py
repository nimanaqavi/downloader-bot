import win32com.client

cst = win32com.client.Dispatch("CSTStudio.Application")
active_mws = cst.Active3D()
if active_mws is None:
    active_mws = cst.NewMWS()

# Simple test to ensure drawing works
vba_simple = """
With Brick
    .Reset
    .Name "VisibleTestBrick"
    .Component "TestSolid"
    .Material "copper"
    .Xrange "-10", "10"
    .Yrange "-10", "10"
    .Zrange "0", "100"
    .Create
End With
"""
active_mws.AddToHistory("VisibleTestBrick_Step", vba_simple)
print("Visible test brick has been added to the current active MWS.")
